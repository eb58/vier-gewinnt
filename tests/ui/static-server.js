import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { extname, normalize, relative, resolve } from 'node:path'

const root = resolve('.')
const port = Number(process.env.PORT ?? 4173)
const mimeTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml'
}

createServer(async (request, response) => {
  const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname)
  const requested = resolve(root, `.${pathname === '/' ? '/index.html' : pathname}`)

  if (relative(root, requested).startsWith('..')) {
    response.writeHead(403).end('Forbidden')
    return
  }

  try {
    const body = await readFile(normalize(requested))
    response.writeHead(200, { 'Content-Type': mimeTypes[extname(requested)] ?? 'application/octet-stream' }).end(body)
  } catch {
    response.writeHead(404).end('Not found')
  }
}).listen(port, '127.0.0.1')
