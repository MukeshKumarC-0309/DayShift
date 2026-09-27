import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach, beforeEach } from 'vitest'

// Node 25 ships an experimental global `localStorage` that shadows jsdom's and
// lacks most of the Storage API without a backing file. Give every test a
// clean, complete in-memory one instead.
class MemoryStorage implements Storage {
  private data = new Map<string, string>()
  get length() {
    return this.data.size
  }
  clear() {
    this.data.clear()
  }
  getItem(key: string) {
    return this.data.get(key) ?? null
  }
  key(index: number) {
    return [...this.data.keys()][index] ?? null
  }
  removeItem(key: string) {
    this.data.delete(key)
  }
  setItem(key: string, value: string) {
    this.data.set(key, String(value))
  }
}

// jsdom has no layout, so no scrolling either.
Element.prototype.scrollIntoView = function scrollIntoView() {}

beforeEach(() => {
  const storage = new MemoryStorage()
  Object.defineProperty(window, 'localStorage', { value: storage, configurable: true })
  Object.defineProperty(globalThis, 'localStorage', {
    value: storage,
    configurable: true,
  })
})

afterEach(() => {
  cleanup()
})
