// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/agent-voice-chat)

const fs = require("fs")
const path = require("path")
const { logger } = require("../src/server/logger")

const MAGIC_HEADER = "ENCR0001"
const HEADER_LENGTH = 8

/**
 * Encrypted file store — reads/writes JSON files with AES-256-GCM encryption.
 * Transparently handles both encrypted and plain JSON files (auto-migrates on write).
 */
class EncryptedFileStore {
  /**
   * @param {import('./encryption').FileEncryption} encryption
   */
  constructor(encryption) {
    this.encryption = encryption
  }

  /**
   * Read a JSON file, decrypting if necessary.
   * Plain JSON files are read as-is (backward compatible).
   * @param {string} filePath
   * @returns {any} Parsed JSON data
   */
  read(filePath) {
    const raw = fs.readFileSync(filePath)
    if (this.isEncrypted(raw)) {
      try {
        const payload = raw.subarray(HEADER_LENGTH)
        const decrypted = this.encryption.decrypt(payload)
        return JSON.parse(decrypted)
      } catch (err) {
        throw new Error(`Failed to decrypt ${path.basename(filePath)}: ${err.message}`)
      }
    }
    // Plain JSON — parse directly (will be encrypted on next write)
    return JSON.parse(raw.toString("utf8"))
  }

  /**
   * Write JSON data to file with encryption.
   * @param {string} filePath
   * @param {any} data - JSON-serializable data
   */
  write(filePath, data) {
    const json = JSON.stringify(data, null, 2)
    const encrypted = this.encryption.encrypt(json)
    const header = Buffer.from(MAGIC_HEADER)
    fs.writeFileSync(filePath, Buffer.concat([header, encrypted]))
  }

  /**
   * Check if a file buffer starts with the encryption magic header.
   * @param {Buffer} data
   * @returns {boolean}
   */
  isEncrypted(data) {
    if (!Buffer.isBuffer(data) || data.length < HEADER_LENGTH) return false
    return data.subarray(0, HEADER_LENGTH).toString() === MAGIC_HEADER
  }
}

/**
 * Plain file store — reads/writes JSON files without encryption.
 * Drop-in replacement for EncryptedFileStore when encryption is disabled.
 */
class PlainFileStore {
  read(filePath) {
    return JSON.parse(fs.readFileSync(filePath, "utf-8"))
  }

  write(filePath, data) {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2))
  }

  isEncrypted() {
    return false
  }
}

/**
 * Create the appropriate file store based on whether an encryption key is provided.
 * @param {string|null} encryptionKey
 * @returns {EncryptedFileStore|PlainFileStore}
 */
function createFileStore(encryptionKey) {
  if (encryptionKey) {
    const { FileEncryption } = require("./encryption")
    const encryption = new FileEncryption(encryptionKey)
    logger.info("Encryption at rest enabled (AES-256-GCM)")
    return new EncryptedFileStore(encryption)
  }
  return new PlainFileStore()
}

module.exports = { EncryptedFileStore, PlainFileStore, createFileStore, MAGIC_HEADER, HEADER_LENGTH }
