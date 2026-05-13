// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent)

/**
 * A fixed-capacity ring buffer that avoids repeated array allocation.
 * Implements push(), slice(), filter(), length, and [Symbol.iterator]
 * so it can be used as a drop-in for the room.messages array pattern:
 *
 *   room.messages.push(msg)
 *   if (room.messages.length > 100) room.messages = room.messages.slice(-100)
 *
 * becomes simply:
 *
 *   room.messages.push(msg)
 *
 * The buffer silently evicts the oldest entry when full instead of
 * allocating a new array on every overflow.
 */
class CircularBuffer {
  constructor(maxSize) {
    this._buf = new Array(maxSize)
    this._head = 0   // next write position
    this._size = 0
    this._maxSize = maxSize
  }

  push(item) {
    this._buf[this._head] = item
    this._head = (this._head + 1) % this._maxSize
    if (this._size < this._maxSize) this._size++
  }

  /** Return all items in insertion (oldest-first) order as a plain array. */
  toArray() {
    if (this._size < this._maxSize) {
      return this._buf.slice(0, this._size)
    }
    // _head is the index of the oldest entry after the buffer is full
    return [...this._buf.slice(this._head), ...this._buf.slice(0, this._head)]
  }

  get length() {
    return this._size
  }

  filter(fn) {
    return this.toArray().filter(fn)
  }

  slice(...args) {
    return this.toArray().slice(...args)
  }

  [Symbol.iterator]() {
    return this.toArray()[Symbol.iterator]()
  }
}

module.exports = { CircularBuffer }


