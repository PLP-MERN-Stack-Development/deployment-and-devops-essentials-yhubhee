// server/server.js
import * as Sentry from "@sentry/node";

Sentry.init({
  dsn: "https://YOUR_SENTRY_DSN_HERE",
  tracesSampleRate: 1.0,
});

app.use(Sentry.Handlers.requestHandler());


const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const dotenv = require('dotenv');
const path = require('path');
const healthcheck = require('./healthcheck');
app.use('/api/health', healthcheck);


dotenv.config();

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: process.env.CLIENT_URL || 'http://localhost:5173',
    methods: ['GET', 'POST'],
    credentials: true,
  },
});

app.use(Sentry.Handlers.errorHandler());


app.use(cors());
app.use(express.json({ limit: '15mb' })); // allow base64 files for dev
app.use(express.static(path.join(__dirname, 'public')));

// In-memory stores (dev only)
const users = {}; // socketId -> { username, id, currentRoom }
const rooms = { global: { name: 'global', messages: [] } }; // roomName -> { name, messages: [] }
// privateMessages: { convoId: [messages...] } where convoId sorted "userA|userB"
const privateMessages = {};
const typingUsers = {}; // roomName -> { socketId: username }
const MAX_MESSAGES_PER_ROOM = 500;

const now = () => new Date().toISOString();
const makeId = () => Math.random().toString(36).slice(2, 10);

// Helpers
function getConvoId(aId, bId) {
  return [aId, bId].sort().join('|');
}

function pushMessageToRoom(roomName, msg) {
  rooms[roomName] = rooms[roomName] || { name: roomName, messages: [] };
  rooms[roomName].messages.push(msg);
  if (rooms[roomName].messages.length > MAX_MESSAGES_PER_ROOM) {
    rooms[roomName].messages.shift();
  }
}

function pushPrivateMessage(convoId, msg) {
  privateMessages[convoId] = privateMessages[convoId] || [];
  privateMessages[convoId].push(msg);
  if (privateMessages[convoId].length > MAX_MESSAGES_PER_ROOM) {
    privateMessages[convoId].shift();
  }
}

// Socket handlers
io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  // support old user_join for backward compatibility
  socket.on('user_join', (username, ack) => {
    users[socket.id] = { username, id: socket.id, currentRoom: 'global' };
    socket.join('global');
    io.emit('user_list', Object.values(users));
    io.to('global').emit('user_joined', { username, id: socket.id });
    // send existing global messages and list of rooms
    socket.emit('init', {
      userId: socket.id,
      rooms: Object.keys(rooms),
      messages: rooms['global'].messages,
    });
    ack && ack({ ok: true, userId: socket.id });
    console.log(`${username} joined (user_join)`);
  });

  // AUTH: simple username join (preferred)
  socket.on('join', ({ username }, ack) => {
    users[socket.id] = { username, id: socket.id, currentRoom: 'global' };
    socket.join('global');
    io.emit('user_list', Object.values(users));
    io.to('global').emit('user_joined', { username, id: socket.id });
    socket.emit('init', {
      userId: socket.id,
      rooms: Object.keys(rooms),
      messages: rooms['global'].messages,
    });
    ack && ack({ ok: true, userId: socket.id });
    console.log(`${username} joined (join)`);
  });

  // Create or join a room
  socket.on('room:join', ({ room }, ack) => {
    if (!room) return ack && ack({ ok: false, reason: 'no-room' });
    rooms[room] = rooms[room] || { name: room, messages: [] };
    const prev = users[socket.id]?.currentRoom;
    if (prev) socket.leave(prev);
    socket.join(room);
    if (users[socket.id]) users[socket.id].currentRoom = room;
    io.to(room).emit('room:info', { room, msg: `${users[socket.id]?.username || 'system'} joined ${room}` });
    // send recent messages for that room to requester
    ack && ack({ ok: true, messages: rooms[room].messages });
    io.emit('room_list', Object.keys(rooms));
    console.log(`${socket.id} joined room ${room}`);
  });

  // Leave a room
  socket.on('room:leave', ({ room }, ack) => {
    if (!room) return ack && ack({ ok: false, reason: 'no-room' });
    socket.leave(room);
    if (users[socket.id]) users[socket.id].currentRoom = 'global';
    io.emit('room_list', Object.keys(rooms));
    ack && ack({ ok: true });
  });

  // Send message to room (supports file via data)
  socket.on('room:message', (payload, ack) => {
    // payload: { room, text?, data?, type? }
    const user = users[socket.id] || { username: 'Anonymous', id: socket.id };
    const room = payload.room || 'global';
    const msg = {
      id: makeId(),
      from: { userId: user.id, username: user.username },
      room,
      text: payload.text || null,
      data: payload.data || null, // { name, base64 } for files
      type: payload.type || (payload.data ? 'file' : 'text'),
      ts: now(),
      readBy: [],
      reactions: {},
    };
    pushMessageToRoom(room, msg);
    io.to(room).emit('room:message', msg);
    ack && ack({ ok: true, id: msg.id });
  });

  // Send private message to a userId
  socket.on('private_message', (payload, ack) => {
    // payload: { to, text?, data?, type? }
    const fromUser = users[socket.id] || { username: 'Anonymous', id: socket.id };
    const toSocketId = payload.to;
    if (!toSocketId) return ack && ack({ ok: false, reason: 'no-target' });

    const msg = {
      id: makeId(),
      from: { userId: fromUser.id, username: fromUser.username },
      to: toSocketId,
      text: payload.text || null,
      data: payload.data || null,
      type: payload.type || (payload.data ? 'file' : 'text'),
      ts: now(),
      read: false,
      reactions: {},
    };

    // store in private convo history
    const convoId = getConvoId(fromUser.id, toSocketId);
    pushPrivateMessage(convoId, msg);

    // emit to recipient and sender
    socket.to(toSocketId).emit('private_message', msg);
    socket.emit('private_message', msg);
    ack && ack({ ok: true, id: msg.id });
  });

  // Read receipt for message (room or private)
  socket.on('message:read', (payload, ack) => {
    // payload: { room?, messageId?, privateWith? } privateWith = otherUserId if private
    if (payload.privateWith) {
      const convoId = getConvoId(socket.id, payload.privateWith);
      const list = privateMessages[convoId] || [];
      const msg = list.find((m) => m.id === payload.messageId);
      if (msg) {
        msg.read = true;
        // notify both participants
        io.to(payload.privateWith).emit('message:read', { messageId: msg.id, by: socket.id });
        socket.emit('message:read', { messageId: msg.id, by: socket.id });
        ack && ack({ ok: true });
      } else ack && ack({ ok: false, reason: 'not-found' });
      return;
    }

    const room = payload.room || users[socket.id]?.currentRoom || 'global';
    const list = (rooms[room] && rooms[room].messages) || [];
    const msg = list.find((m) => m.id === payload.messageId);
    if (msg) {
      msg.readBy = msg.readBy || [];
      if (!msg.readBy.includes(socket.id)) msg.readBy.push(socket.id);
      io.to(room).emit('message:read', { messageId: msg.id, by: socket.id });
      ack && ack({ ok: true });
    } else ack && ack({ ok: false, reason: 'not-found' });
  });

  // Reactions to messages (room or private)
  socket.on('message:react', (payload, ack) => {
    // payload: { room?, messageId, reaction, privateWith? }
    if (payload.privateWith) {
      const convoId = getConvoId(socket.id, payload.privateWith);
      const list = privateMessages[convoId] || [];
      const msg = list.find((m) => m.id === payload.messageId);
      if (msg) {
        msg.reactions = msg.reactions || {};
        msg.reactions[payload.reaction] = (msg.reactions[payload.reaction] || 0) + 1;
        io.to(payload.privateWith).emit('message:react', { messageId: msg.id, reactions: msg.reactions });
        socket.emit('message:react', { messageId: msg.id, reactions: msg.reactions });
        ack && ack({ ok: true });
      } else ack && ack({ ok: false });
      return;
    }

    const room = payload.room || 'global';
    const list = (rooms[room] && rooms[room].messages) || [];
    const msg = list.find((m) => m.id === payload.messageId);
    if (msg) {
      msg.reactions = msg.reactions || {};
      msg.reactions[payload.reaction] = (msg.reactions[payload.reaction] || 0) + 1;
      io.to(room).emit('message:react', { messageId: msg.id, reactions: msg.reactions });
      ack && ack({ ok: true });
    } else ack && ack({ ok: false, reason: 'not-found' });
  });

  // Typing indicator per room (or global)
  socket.on('typing', (payload) => {
    // payload: { room?, typing: true|false }
    const room = payload?.room || users[socket.id]?.currentRoom || 'global';
    if (payload.typing) {
      typingUsers[room] = typingUsers[room] || {};
      typingUsers[room][socket.id] = users[socket.id]?.username || 'Anonymous';
    } else {
      if (typingUsers[room]) delete typingUsers[room][socket.id];
    }
    io.to(room).emit('typing_users', Object.values(typingUsers[room] || {}));
  });

  // Provide list of rooms and users
  socket.on('get:rooms', (ack) => {
    ack && ack({ rooms: Object.keys(rooms) });
  });

  socket.on('get:privateHistory', ({ withUserId }, ack) => {
    const convoId = getConvoId(socket.id, withUserId);
    ack && ack({ messages: privateMessages[convoId] || [] });
  });

  // standard disconnect
  socket.on('disconnect', () => {
    if (users[socket.id]) {
      const username = users[socket.id].username;
      console.log(`${username} disconnected (${socket.id})`);
      delete users[socket.id];
      // clear typing entries
      Object.keys(typingUsers).forEach((r) => {
        if (typingUsers[r]) delete typingUsers[r][socket.id];
      });
      io.emit('user_left', { id: socket.id });
      io.emit('user_list', Object.values(users));
      io.emit('typing_users', []); // broadcast cleared typing
    } else {
      console.log('Unknown socket disconnected:', socket.id);
    }
  });
});

// Basic API endpoints for debugging
app.get('/api/rooms', (req, res) => {
  res.json(Object.keys(rooms));
});

app.get('/api/rooms/:room/messages', (req, res) => {
  const room = req.params.room;
  res.json(rooms[room]?.messages || []);
});

app.get('/api/private/:userA/:userB', (req, res) => {
  const convoId = getConvoId(req.params.userA, req.params.userB);
  res.json(privateMessages[convoId] || []);
});

app.get('/', (req, res) => res.send('Socket.io Chat Server (advanced)'));

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));

module.exports = { app, server, io };
