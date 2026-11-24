import { spawn } from 'node:child_process'

interface LspMessage {
  error?: { message?: string }
  id?: number
  method?: string
  result?: unknown
}

interface PendingRequest {
  reject: (error: Error) => void
  resolve: (result: unknown) => void
  timeout: NodeJS.Timeout
}

export interface LspSession {
  close(): Promise<void>
  notify(method: string, params: object): void
  request(method: string, params: unknown): Promise<unknown>
}

export interface LspSessionOptions {
  cwd: string
  env?: NodeJS.ProcessEnv
  /** Name used in error messages. */
  name: string
  timeoutMs?: number
}

function encodeMessage(message: object): string {
  const body = JSON.stringify(message)
  return `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`
}

export function startLspSession(entryPath: string, options: LspSessionOptions): LspSession {
  const { cwd, env, name, timeoutMs = 5_000 } = options
  const child = spawn(process.execPath, [entryPath, '--lsp'], {
    cwd,
    env,
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  const pendingRequests = new Map<number, PendingRequest>()
  let buffer = Buffer.alloc(0)
  let closed = false
  let nextRequestId = 1
  let stderr = ''
  const childClosed = new Promise<number | null>((resolve) => {
    child.once('close', (code) => resolve(code))
  })

  function failPendingRequests(error: Error): void {
    for (const pendingRequest of pendingRequests.values()) {
      clearTimeout(pendingRequest.timeout)
      pendingRequest.reject(error)
    }
    pendingRequests.clear()
  }

  function fail(error: Error): void {
    if (closed) {
      return
    }
    closed = true
    failPendingRequests(error)
    child.kill('SIGTERM')
  }

  function send(message: object): void {
    child.stdin.write(encodeMessage(message))
  }

  function request(method: string, params: unknown): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const id = nextRequestId++
      const timeout = setTimeout(() => {
        pendingRequests.delete(id)
        reject(new Error(`Timed out waiting for ${name} LSP ${method}\n${stderr}`))
      }, timeoutMs)
      pendingRequests.set(id, { reject, resolve, timeout })
      send({ id, jsonrpc: '2.0', method, params })
    })
  }

  child.stderr.setEncoding('utf8')
  child.stderr.on('data', (chunk: string) => {
    stderr += chunk
  })
  child.once('error', (error) => fail(error))
  child.once('close', (code) => {
    fail(new Error(`${name} LSP exited with code ${code}\n${stderr}`))
  })
  child.stdout.on('data', (chunk: Buffer) => {
    buffer = Buffer.concat([buffer, chunk])

    while (true) {
      const headerEnd = buffer.indexOf('\r\n\r\n')
      if (headerEnd === -1) {
        return
      }
      const header = buffer.subarray(0, headerEnd).toString('utf8')
      const contentLength = /Content-Length: (\d+)/i.exec(header)?.[1]
      if (!contentLength) {
        fail(new Error(`${name} LSP sent an invalid header: ${header}`))
        return
      }
      const messageEnd = headerEnd + 4 + Number(contentLength)
      if (buffer.length < messageEnd) {
        return
      }

      const message = JSON.parse(
        buffer.subarray(headerEnd + 4, messageEnd).toString('utf8'),
      ) as LspMessage
      buffer = buffer.subarray(messageEnd)

      if (message.method && message.id !== undefined) {
        send({ id: message.id, jsonrpc: '2.0', result: null })
        continue
      }
      if (message.id === undefined) {
        continue
      }

      const pendingRequest = pendingRequests.get(message.id)
      if (!pendingRequest) {
        continue
      }
      pendingRequests.delete(message.id)
      clearTimeout(pendingRequest.timeout)
      if (message.error) {
        pendingRequest.reject(new Error(message.error.message ?? `${name} LSP request failed`))
      } else {
        pendingRequest.resolve(message.result)
      }
    }
  })

  return {
    async close(): Promise<void> {
      if (closed) {
        await childClosed
        return
      }
      try {
        await request('shutdown', null)
        send({ jsonrpc: '2.0', method: 'exit' })
      } catch (error) {
        fail(error instanceof Error ? error : new Error(String(error)))
        await childClosed
        throw error
      }
      const exitCode = await childClosed
      if (exitCode !== 0) {
        throw new Error(`${name} LSP exited with code ${exitCode}\n${stderr}`)
      }
    },
    notify(method: string, params: object): void {
      send({ jsonrpc: '2.0', method, params })
    },
    request,
  }
}
