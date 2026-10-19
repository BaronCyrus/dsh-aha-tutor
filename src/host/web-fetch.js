// Fetching learner-supplied web addresses without reaching the learner's own
// machine or network: every address a name resolves to is checked when the
// connection is made (so a name cannot resolve to a public address for the
// check and a private one for the connection), IP literals are checked
// directly, and redirects are left to the caller so each hop is checked too.

import { lookup as dnsLookup } from 'node:dns'
import http from 'node:http'
import https from 'node:https'
import { isIP } from 'node:net'
import { pipeline } from 'node:stream'
import zlib from 'node:zlib'

export const LOCAL_ADDRESS_MESSAGE = 'Local network addresses are not supported'

export class AddressError extends Error {
  constructor(message = LOCAL_ADDRESS_MESSAGE) {
    super(message)
    this.name = 'AddressError'
    this.code = 'bad-url'
  }
}

// Not reachable on the public internet: this host, private networks,
// link-local (cloud metadata lives there), shared, reserved and multicast.
const V4_BLOCKED = [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
  ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.88.99.0', 24], ['192.168.0.0', 16],
  ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
].map(([base, bits]) => [v4Number(base), bits])

// IPv6 prefixes refused outright (unique-local, link-local, site-local,
// multicast, discard, documentation, Teredo and other IETF special ranges).
const V6_BLOCKED = [
  ['fc00::', 7], ['fe80::', 10], ['fec0::', 10], ['ff00::', 8], ['100::', 64], ['64:ff9b:1::', 48],
  ['2001::', 32], ['2001:2::', 48], ['2001:10::', 28], ['2001:20::', 28], ['2001:db8::', 32],
].map(([base, bits]) => [v6Bytes(base), bits])

function v4Number(address) {
  const parts = address.split('.').map(Number)
  return (((parts[0] << 24) >>> 0) + (parts[1] << 16) + (parts[2] << 8) + parts[3]) >>> 0
}

function v4Public(address) {
  const value = v4Number(address)
  return !V4_BLOCKED.some(([base, bits]) => (bits === 0 ? true : (value >>> (32 - bits)) === (base >>> (32 - bits))))
}

// 16 bytes for an IPv6 address, including forms with a dotted IPv4 tail.
function v6Bytes(address) {
  let text = String(address).toLowerCase()
  const zone = text.indexOf('%')
  if (zone >= 0) text = text.slice(0, zone)
  const groups = []
  const dotted = text.match(/(\d+\.\d+\.\d+\.\d+)$/u)
  if (dotted) {
    const value = v4Number(dotted[1])
    text = `${text.slice(0, -dotted[1].length)}${(value >>> 16).toString(16)}:${(value & 0xffff).toString(16)}`
  }
  const [head, tail] = text.includes('::') ? text.split('::') : [text, null]
  const left = head ? head.split(':') : []
  const right = tail ? tail.split(':') : []
  const fill = tail === null ? 0 : 8 - left.length - right.length
  for (const group of [...left, ...Array(Math.max(0, fill)).fill('0'), ...right]) groups.push(Number.parseInt(group || '0', 16))
  const bytes = new Uint8Array(16)
  groups.slice(0, 8).forEach((group, index) => {
    bytes[index * 2] = (group >> 8) & 0xff
    bytes[index * 2 + 1] = group & 0xff
  })
  return bytes
}

function prefixMatches(bytes, base, bits) {
  for (let bit = 0; bit < bits; bit += 8) {
    const width = Math.min(8, bits - bit)
    const mask = (0xff << (8 - width)) & 0xff
    if ((bytes[bit / 8] & mask) !== (base[bit / 8] & mask)) return false
  }
  return true
}

const embeddedV4 = (bytes, at) => `${bytes[at]}.${bytes[at + 1]}.${bytes[at + 2]}.${bytes[at + 3]}`

function v6Public(address) {
  const bytes = v6Bytes(address)
  const zeros = count => bytes.subarray(0, count).every(byte => byte === 0)
  // ::a.b.c.d (IPv4-compatible, including :: and ::1) and ::ffff:a.b.c.d
  // (IPv4-mapped) reach the embedded IPv4 address.
  if (zeros(12) || (zeros(10) && bytes[10] === 0xff && bytes[11] === 0xff)) return v4Public(embeddedV4(bytes, 12))
  // NAT64 (64:ff9b::/96) and 6to4 (2002::/16) carry an IPv4 address as well.
  if (prefixMatches(bytes, v6Bytes('64:ff9b::'), 96)) return v4Public(embeddedV4(bytes, 12))
  if (bytes[0] === 0x20 && bytes[1] === 0x02) return v4Public(embeddedV4(bytes, 2))
  return !V6_BLOCKED.some(([base, bits]) => prefixMatches(bytes, base, bits))
}

export function isPublicAddress(address) {
  const value = String(address ?? '').replace(/^\[|\]$/gu, '')
  const family = isIP(value.split('%')[0])
  if (family === 4) return v4Public(value)
  if (family === 6) return v6Public(value)
  return false
}

// Names that never mean a public site, whatever they resolve to.
const LOCAL_NAME = /(^|\.)(localhost|local|internal|home\.arpa)$/u

// Checks a URL hostname that needs no lookup: IP literals and local names.
// Returns false for names that must still be resolved.
export function assertPublicHostname(hostname) {
  const host = String(hostname ?? '').replace(/^\[|\]$/gu, '').replace(/\.+$/u, '').toLowerCase()
  if (!host) throw new AddressError('This is not a valid web address')
  if (isIP(host)) {
    if (!isPublicAddress(host)) throw new AddressError()
    return true
  }
  if (LOCAL_NAME.test(host) || !host.includes('.')) throw new AddressError()
  return false
}

// A dns.lookup replacement for sockets: resolves every address, refuses the
// connection if any of them is local, and connects only to checked ones.
export function createGuardedLookup({ resolve = dnsLookup, allowed = isPublicAddress } = {}) {
  return function guardedLookup(hostname, options, callback) {
    const done = typeof options === 'function' ? options : callback
    const wanted = typeof options === 'object' && options ? options : {}
    resolve(hostname, { all: true }, (error, addresses) => {
      if (error) return done(error)
      const list = (Array.isArray(addresses) ? addresses : [])
        .map(entry => (typeof entry === 'string' ? { address: entry, family: isIP(entry) } : entry))
        .filter(entry => entry?.address)
      if (!list.length) return done(Object.assign(new Error(`No address for ${hostname}`), { code: 'ENOTFOUND' }))
      if (list.some(entry => !allowed(entry.address))) return done(new AddressError())
      const family = wanted.family === 4 || wanted.family === 6 ? wanted.family : 0
      const usable = family ? list.filter(entry => entry.family === family) : list
      const chosen = usable.length ? usable : list
      if (wanted.all) return done(null, chosen.map(entry => ({ address: entry.address, family: entry.family })))
      return done(null, chosen[0].address, chosen[0].family)
    })
  }
}

const EMPTY_BODY_STATUS = new Set([101, 204, 205, 304])

function decoded(response) {
  const encoding = String(response.headers['content-encoding'] ?? '').trim().toLowerCase()
  const decoder = encoding === 'gzip' || encoding === 'x-gzip' ? zlib.createGunzip()
    : encoding === 'deflate' ? zlib.createInflate()
      : encoding === 'br' ? zlib.createBrotliDecompress()
        : null
  if (!decoder) return response
  return pipeline(response, decoder, () => undefined)
}

function toHeaders(raw) {
  const headers = new Headers()
  for (const [name, value] of Object.entries(raw ?? {})) {
    if (name === 'content-encoding' || name === 'content-length' || value === undefined) continue
    for (const entry of Array.isArray(value) ? value : [value]) {
      try {
        headers.append(name, String(entry))
      } catch {
        // a header WHATWG refuses is not one the importer needs
      }
    }
  }
  return headers
}

// One GET without following redirects; resolves with a WHATWG Response whose
// body is already read (and decompressed), capped at maxBytes.
export function createGuardedFetch({ resolve, allowed = isPublicAddress, maxBytes = 64 * 1024 * 1024 } = {}) {
  const lookup = createGuardedLookup({ resolve, allowed })
  return function guardedFetch(input, { headers = {}, signal } = {}) {
    return new Promise((fulfil, reject) => {
      let target
      try {
        target = input instanceof URL ? input : new URL(String(input))
        if (target.protocol !== 'http:' && target.protocol !== 'https:') throw new AddressError('Only http and https addresses are supported')
        const literal = target.hostname.replace(/^\[|\]$/gu, '')
        if (isIP(literal) && !allowed(literal)) throw new AddressError()
      } catch (error) {
        reject(error)
        return
      }
      const transport = target.protocol === 'https:' ? https : http
      let settled = false
      const fail = error => {
        if (settled) return
        settled = true
        reject(error)
      }
      const request = transport.request(target, {
        method: 'GET',
        agent: false,
        lookup,
        signal,
        headers: { ...headers, 'accept-encoding': 'gzip, deflate, br' },
      }, response => {
        const status = response.statusCode ?? 0
        if (status < 200 || status > 599) {
          response.resume()
          fail(Object.assign(new Error(`Unexpected status ${status}`), { code: 'EBADSTATUS' }))
          return
        }
        if ((status >= 300 && status < 400) || EMPTY_BODY_STATUS.has(status)) {
          response.resume()
          settled = true
          fulfil(new Response(null, { status, headers: toHeaders(response.headers) }))
          return
        }
        const body = decoded(response)
        const parts = []
        let size = 0
        body.on('data', chunk => {
          if (settled) return
          size += chunk.length
          if (size > maxBytes) {
            request.destroy()
            body.destroy?.()
            fail(Object.assign(new Error('Response too large'), { code: 'ETOOLARGE' }))
            return
          }
          parts.push(chunk)
        })
        body.on('error', fail)
        body.on('end', () => {
          if (settled) return
          settled = true
          fulfil(new Response(Buffer.concat(parts), { status, headers: toHeaders(response.headers) }))
        })
      })
      request.on('error', fail)
      request.end()
    })
  }
}

export const guardedFetch = createGuardedFetch()
