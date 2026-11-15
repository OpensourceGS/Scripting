const http = require('node:http')
const body = 'DOMAIN,fixture.invalid,DIRECT\n'
const counts = { file: 0, conditional: 0, large: 0 }
const server = http.createServer((req, res) => {
  if (req.url === '/stats') { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(counts)); return }
  if (req.url === '/large') {
    counts.large++
    res.writeHead(200, { 'Content-Type': 'text/plain', 'Content-Length': 2 * 1024 * 1024 })
    res.flushHeaders()
    let sent = 0
    const timer = setInterval(() => {
      if (res.destroyed) { clearInterval(timer); return }
      res.write(Buffer.alloc(4096, 65)); sent += 4096
      if (sent >= 2 * 1024 * 1024) { clearInterval(timer); res.end() }
    }, 10)
    res.on('close', () => clearInterval(timer))
    return
  }
  if (req.url !== '/file') { res.writeHead(404); res.end(); return }
  counts.file++
  if (req.headers['if-none-match'] === '"fixture-v1"') {
    counts.conditional++
    res.writeHead(304, { ETag: '"fixture-v1"' }); res.end(); return
  }
  res.writeHead(200, { 'Content-Type': 'text/plain', ETag: '"fixture-v1"', 'Content-Length': Buffer.byteLength(body) })
  res.end(body)
})
server.listen(0, '127.0.0.1', () => console.log(JSON.stringify({ port: server.address().port })))
