var noise = require('noise-protocol')
var assert = require('nanoassert')

var EMPTY = Buffer.alloc(0)

// transportStream should be duplex stream
module.exports = function handshakeStream (transportStream, isInitiator, onhandshake, opts) {
  opts = opts || {}

  var handshakePattern = 'XX'
  var prolougeBuf = EMPTY
  if (opts.onpayload == null) opts.onpayload = (_1, _2, cb) => { cb(null, EMPTY) }

  var state = noise.initialize(handshakePattern, isInitiator, prolougeBuf)
  // initiators should send first message, so if initiator, waiting = false
  // while servers should await any message, so if not initiator, waiting = true
  var waiting = isInitiator === false
  var finished = false
  // Will hold the "split" for transport encryption after handshake
  var split = null

  // ~64KiB is the max noise message length
  var tx = Buffer.alloc(65535)
  var rx = Buffer.alloc(65535)

  // If not waiting, kick at next tick to start sending handshake
  if (waiting === false) process.nextTick(tick)
  // Read data in discrete chunks
  transportStream.on('data', tick)

  function tick (data) {
    assert(finished === false, 'Should not call tick if finished')
    assert(data == null || waiting === true, 'Wrong state')
    assert(split == null, 'split should be null')

    if (waiting === true) {
      assert(data.byteLength <= 65535)
      try {
        split = noise.readMessage(state, data, rx)
      } catch (ex) {
        return onfinish(ex)
      }
      // Messages received before the handshake has completed
      // readable.write(rx.subarray(0, noise.readMessage.bytes))
      waiting = false

      if (split) return onfinish()
    }

    if (waiting === false) {
      try {
        split = noise.writeMessage(state, EMPTY, tx)
      } catch (ex) {
        return onfinish(ex)
      }

      transportStream.write(tx.subarray(0, noise.writeMessage.bytes))
      waiting = true

      if (split) return onfinish()
    }
  }

  function onfinish (err) {
    if (finished) throw new Error('Already finished')

    finished = true
    waiting = false

    transportStream.removeListener('data', tick)
    noise.destroy(state)

    onhandshake(err, transportStream)
  }
}
