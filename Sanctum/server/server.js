import { WebSocketServer } from 'ws';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { PACKET_TYPES, GAME_MODES } from '../shared/Constants.js';
import { GameRoom } from './GameRoom.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CLIENT_DIR = path.join(__dirname, '../client');
const SHARED_DIR = path.join(__dirname, '../shared');
const PORT = process.env.PORT || 8080;

const server = http.createServer((req, res) => {
  let reqPath = req.url.split('?')[0];
  if (reqPath === '/' || reqPath === '') reqPath = '/index.html';

  const filePath = reqPath.startsWith('/shared/')
    ? path.join(SHARED_DIR, reqPath.replace('/shared/', ''))
    : path.join(CLIENT_DIR, reqPath);

  const ext = path.extname(filePath);
  const mimeTypes = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };

  fs.readFile(filePath, (err, content) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('404 Not Found');
    } else {
      res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'application/octet-stream' });
      res.end(content, 'utf-8');
    }
  });
});

const wss = new WebSocketServer({ server });
const rooms = new Map();
let nextSocketId = 1;

function getOrCreateRoom(roomName, mode = GAME_MODES.CLASSIC) {
  const roomId = `${mode}_${roomName}`;
  if (!rooms.has(roomId)) {
    console.log(`[Lobby] Creating new ${mode} room: ${roomId}`);
    rooms.set(roomId, new GameRoom(roomId, mode));
  }
  return rooms.get(roomId);
}

wss.on('connection', (ws) => {
  ws.id = nextSocketId++;
  let currentRoom = null;
  console.log(`[Server] Client #${ws.id} connected`);

  ws.on('message', (message) => {
    try {
      const packet = JSON.parse(message);
      if (packet.type === PACKET_TYPES.JOIN_LOBBY) {
        const { roomName, mode, playerName } = packet.data;
        const targetMode = mode === GAME_MODES.HARDCORE ? GAME_MODES.HARDCORE : GAME_MODES.CLASSIC;
        currentRoom = getOrCreateRoom(roomName || 'sanctum_depths', targetMode);
        currentRoom.addPlayer(ws, playerName || `Player_${ws.id}`);
      } else if (currentRoom) {
        currentRoom.handlePlayerInput(ws.id, packet);
      }
    } catch (e) {
      console.error('[Server] Malformed packet:', e);
    }
  });

  ws.on('close', () => {
    console.log(`[Server] Client #${ws.id} disconnected`);
    if (currentRoom) currentRoom.removePlayer(ws.id);
  });
});

server.listen(PORT, () => {
  console.log(`\n* PROJECT: SANCTUM running at http://localhost:${PORT} (15 Hz authoritative)`);
});
