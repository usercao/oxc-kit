export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function hasErrorCode(error: unknown, ...codes: string[]): boolean {
  return (
    isObject(error) &&
    'code' in error &&
    typeof error.code === 'string' &&
    codes.includes(error.code)
  )
}
