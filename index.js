var noise = require('noise-protocol')
var assert = require('nanoassert')
var each = require('stream-each')
var EMPTY = Buffer.alloc(0)

// transportStream should be duplex stream
module.exports = handshakeStream
function handshakeStream (transportStream, isInitiator, opts, onhandshake) {
  if (typeof opts === 'function') return handshakeStream(transportStream, isInitiator, null, opts)

  opts = opts || {}

  var pattern = opts.pattern || 'NN'
  var prolouge = opts.prolouge || EMPTY

  var onstatickey = opts.onstatickey || function (_, cb) { cb() }

  var state = noise.initialize(
    pattern,
    isInitiator,
    prolouge,
    opts.staticKeyPair,
    opts.ephemeralKeyPair,
    opts.remoteStaticKey,
    opts.remoteEphemeralKey
  )

  // initiators should send first message, so if initiator, waiting = false
  // while servers should await any message, so if not initiator, waiting = true
  var waiting = isInitiator === false
  var finished = false
  // Will hold the "split" for transport encryption after handshake
  var split = null

  // ~64KiB is the max noise message length
  var tx = Buffer.alloc(65535)
  var rx = Buffer.alloc(65535)

  // If not waiting, kick to start sending handshake
  if (waiting === false) send(function (err) { if (err) onfinish(err) })
  // Read data in discrete chunks
  each(transportStream, recv)

  function recv (data, cb) {
    assert(finished === false, 'Should not call tick if finished')
    assert(data != null, 'must have data')
    assert(data.byteLength <= rx.byteLength)
    assert(waiting === true, 'Wrong state')
    assert(split == null, 'split should be null')

    var hasSkBefore = state.rs != null
    try {
      split = noise.readMessage(state, data, rx)
    } catch (ex) {
      return onfinish(ex)
    }
    // Messages received before the handshake has completed
    // readable.write(rx.subarray(0, noise.readMessage.bytes))
    waiting = false

    var hasSkAfter = state.rs != null

    if (hasSkBefore === false && hasSkAfter === true) return onstatickey(state.rs, ondone)

    return ondone()

    function ondone (err) {
      if (err) return onfinish(err)
      if (split) return onfinish()

      send(cb)
    }
  }

  function send (cb) {
    assert(finished === false, 'Should not call tick if finished')
    assert(waiting === false, 'Wrong state')
    assert(split == null, 'split should be null')

    try {
      split = noise.writeMessage(state, EMPTY, tx)
    } catch (ex) {
      return onfinish(ex)
    }

    waiting = true
    transportStream.write(tx.subarray(0, noise.writeMessage.bytes))

    if (split != null) return onfinish()

    return cb()
  }

  function onfinish (err) {
    if (finished) throw new Error('Already finished')

    finished = true
    waiting = false

    noise.destroy(state)

    onhandshake(err, transportStream, split)
  }
}

handshakeStream.keygen = noise.keygen
