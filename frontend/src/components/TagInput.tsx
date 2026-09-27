import { useId, useState } from 'react'

import { tagTone } from '../theme'

/**
 * Tags as chips plus a text field. Enter, comma or Tab adds what's typed;
 * Backspace on an empty field removes the last chip. Tags are lowercased and
 * trimmed here the same way the backend stores them, so what you see is what
 * gets saved. Earlier tags are offered as suggestions (a native datalist).
 */

export const MAX_TAGS = 12
export const MAX_TAG_LENGTH = 48

interface Props {
  tags: string[]
  onChange: (tags: string[]) => void
  /** Tags used before, suggested while typing. */
  suggestions?: string[]
  disabled?: boolean
  placeholder?: string
  className?: string
}

export function normaliseTag(raw: string): string {
  return raw.trim().toLowerCase().slice(0, MAX_TAG_LENGTH)
}

export default function TagInput({
  tags,
  onChange,
  suggestions = [],
  disabled = false,
  placeholder = 'Add a tag',
  className = '',
}: Props) {
  const [draft, setDraft] = useState('')
  const listId = useId()
  const full = tags.length >= MAX_TAGS

  function add(raw: string) {
    const names = raw.split(',').map(normaliseTag).filter(Boolean)
    const next = [...tags]
    for (const name of names) {
      if (!next.includes(name) && next.length < MAX_TAGS) next.push(name)
    }
    if (next.length !== tags.length) onChange(next)
    setDraft('')
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if ((event.key === 'Enter' || event.key === ',') && draft.trim()) {
      event.preventDefault()
      add(draft)
    } else if (event.key === 'Tab' && draft.trim()) {
      add(draft) // let focus move on as usual
    } else if (event.key === 'Backspace' && draft === '' && tags.length > 0) {
      onChange(tags.slice(0, -1))
    }
  }

  const unused = suggestions.filter((s) => !tags.includes(s))

  return (
    <div
      className={`term-input flex min-h-[34px] flex-wrap items-center gap-1 py-1 ${className}`}
    >
      {tags.map((tag) => (
        <span key={tag} className={`chip ${tagTone(tag)} flex items-center gap-1`}>
          {tag}
          {!disabled && (
            <button
              type="button"
              onClick={() => onChange(tags.filter((t) => t !== tag))}
              className="leading-none opacity-70 hover:opacity-100"
              aria-label={`Remove tag ${tag}`}
            >
              ×
            </button>
          )}
        </span>
      ))}
      {!full && (
        <input
          type="text"
          value={draft}
          disabled={disabled}
          maxLength={MAX_TAG_LENGTH}
          list={unused.length ? listId : undefined}
          placeholder={tags.length ? '' : placeholder}
          onChange={(e) => {
            // A pasted "a, b" or a picked suggestion ending in a comma.
            if (e.target.value.includes(',')) add(e.target.value)
            else setDraft(e.target.value)
          }}
          onKeyDown={onKeyDown}
          onBlur={() => draft.trim() && add(draft)}
          className="min-w-[90px] flex-1 bg-transparent font-mono text-[12px] text-ink outline-none placeholder:text-faint"
          aria-label="Tags"
        />
      )}
      {unused.length > 0 && (
        <datalist id={listId}>
          {unused.map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>
      )}
    </div>
  )
}
