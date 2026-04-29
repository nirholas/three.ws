// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent)

const { createCipheriv, createDecipheriv, randomBytes, scryptSync } = require("crypto")

const ALGORITHM = "aes-256-gcm"
const KEY_LENGTH = 32
const IV_LENGTH = 16
const TAG_LENGTH = 16
const SALT = "agent-voice-chat-salt"

class FileEncryption {
  /**
   * @param {string} masterKey - Master key (any length, derived via scrypt)
   */
  constructor(masterKey) {
    if (!masterKey || typeof masterKey !== "string") {
      throw new Error("Encryption requires a non-empty master key")
    }
    this.key = scryptSync(masterKey, SALT, KEY_LENGTH)
  }

  /**
   * Encrypt plaintext string to Buffer.
   * Format: iv (16 bytes) + authTag (16 bytes) + ciphertext
   * @param {string} plaintext
   * @returns {Buffer}
   */
  encrypt(plaintext) {
    const iv = randomBytes(IV_LENGTH)
    const cipher = createCipheriv(ALGORITHM, this.key, iv)
    const encrypted = Buffer.concat([
      cipher.update(plaintext, "utf8"),
      cipher.final(),
    ])
    const tag = cipher.getAuthTag()
    return Buffer.concat([iv, tag, encrypted])
  }

  /**
   * Decrypt Buffer back to plaintext string.
   * @param {Buffer} data - iv + authTag + ciphertext
   * @returns {string}
   */
  decrypt(data) {
    if (!Buffer.isBuffer(data)) {
      throw new Error("decrypt expects a Buffer")
    }
    if (data.length < IV_LENGTH + TAG_LENGTH) {
      throw new Error("Encrypted data too short — file may be corrupted")
    }
    const iv = data.subarray(0, IV_LENGTH)
    const tag = data.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH)
    const ciphertext = data.subarray(IV_LENGTH + TAG_LENGTH)
    const decipher = createDecipheriv(ALGORITHM, this.key, iv)
    decipher.setAuthTag(tag)
    try {
      return decipher.update(ciphertext, undefined, "utf8") + decipher.final("utf8")
    } catch (err) {
      if (err.message.includes("Unsupported state") || err.code === "ERR_OSSL_BAD_DECRYPT") {
        throw new Error("Decryption failed — wrong key or corrupted data")
      }
      throw err
    }
  }
}

module.exports = { FileEncryption, ALGORITHM, KEY_LENGTH, IV_LENGTH, TAG_LENGTH }


