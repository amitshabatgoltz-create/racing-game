const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

// All connected players (not in any room yet)
const lobby = {}; // socketId -> {id, name, wins, carId, carColor}

// Active rooms
const rooms = {}; // roomId -> {players:{}, state, winner, countdown}

const startPositions = [
  {x:90,z:0},{x:86,z:3},{x:86,z:-3},{x:82,z:5},{x:82,z:-5}
];
const startTs = [0.003,0.008,0.013,0.018,0.023];

io.on('connection', (socket) => {

  // Player enters lobby (not a room yet)
  socket.on('join', (data) => {
    lobby[socket.id] = {
      id: socket.id,
      name: data.name || 'Player',
      wins: data.wins || 0,
      carId: data.carId || 'mclaren',
      carColor: data.carColor || 0x4a9eff
    };
    socket.emit('joined_lobby', { players: lobby });
    // Tell everyone else this player is online
    socket.broadcast.emit('lobby_update', lobby);
    console.log(`${data.name} entered lobby. Online: ${Object.keys(lobby).length}`);
  });

  // Send invite to another player
  socket.on('send_invite', (data) => {
    const target = io.sockets.sockets.get(data.targetId);
    if(target && lobby[data.targetId]){
      target.emit('receive_invite', {
        fromId: socket.id,
        fromName: lobby[socket.id]?.name,
        carId: lobby[socket.id]?.carId,
        carColor: lobby[socket.id]?.carColor
      });
    }
  });

  // Accept invite — create a room for these two
  socket.on('accept_invite', (data) => {
    const fromId = data.fromId;
    if(!lobby[fromId] || !lobby[socket.id]) return;

    // Create room
    const roomId = fromId + '_' + socket.id;
    rooms[roomId] = { players: {}, state: 'waiting', winner: null };

    [fromId, socket.id].forEach((id, idx) => {
      const p = lobby[id];
      const sp = startPositions[idx];
      rooms[roomId].players[id] = {
        ...p, num: idx+1, ready: false,
        x: sp.x, z: sp.z,
        angle: Math.PI/2, speed: 0,
        lap: 1, t: startTs[idx]
      };
      const s = io.sockets.sockets.get(id);
      if(s){ s.join(roomId); s.data.roomId = roomId; }
    });

    io.to(roomId).emit('room_created', {
      roomId,
      players: rooms[roomId].players,
      yourIds: { [fromId]: fromId, [socket.id]: socket.id }
    });

    // Tell inviter
    const fromSocket = io.sockets.sockets.get(fromId);
    if(fromSocket) fromSocket.emit('invite_accepted', { name: lobby[socket.id]?.name });

    console.log(`Room created: ${lobby[fromId]?.name} vs ${lobby[socket.id]?.name}`);
  });

  // Decline invite
  socket.on('decline_invite', (data) => {
    const fromSocket = io.sockets.sockets.get(data.fromId);
    if(fromSocket) fromSocket.emit('invite_declined', { name: lobby[socket.id]?.name });
  });

  // Player ready
  socket.on('player_ready', () => {
    const roomId = socket.data.roomId;
    if(!roomId || !rooms[roomId]) return;
    rooms[roomId].players[socket.id].ready = true;
    io.to(roomId).emit('player_ready', { id: socket.id });

    const players = Object.values(rooms[roomId].players);
    if(players.length >= 2 && players.every(p => p.ready) && rooms[roomId].state === 'waiting'){
      rooms[roomId].state = 'countdown';
      startCountdown(roomId);
    }
  });

  // Position update
  socket.on('update', (data) => {
    const roomId = socket.data.roomId;
    if(!roomId || !rooms[roomId]) return;
    Object.assign(rooms[roomId].players[socket.id], data);
    socket.to(roomId).emit('player_update', { id: socket.id, ...data });
  });

  // Finished
  socket.on('finished', (data) => {
    const roomId = socket.data.roomId;
    if(!roomId || !rooms[roomId]) return;
    rooms[roomId].players[socket.id].finished = true;
    if(!rooms[roomId].winner){
      rooms[roomId].winner = socket.id;
      io.to(roomId).emit('race_finished', {
        winnerId: socket.id,
        winnerName: rooms[roomId].players[socket.id]?.name,
        time: data.time
      });
    }
  });

  // Disconnect
  socket.on('disconnect', () => {
    const name = lobby[socket.id]?.name || 'Unknown';
    delete lobby[socket.id];
    socket.broadcast.emit('lobby_update', lobby);

    const roomId = socket.data.roomId;
    if(roomId && rooms[roomId]){
      delete rooms[roomId].players[socket.id];
      socket.to(roomId).emit('player_left', { id: socket.id, name });
      if(Object.keys(rooms[roomId].players).length === 0) delete rooms[roomId];
    }
    console.log(`${name} disconnected`);
  });
});

function startCountdown(roomId){
  let val = 3;
  io.to(roomId).emit('countdown', { val });
  const interval = setInterval(() => {
    val--;
    if(val <= 0){
      clearInterval(interval);
      if(rooms[roomId]) rooms[roomId].state = 'racing';
      io.to(roomId).emit('race_start', { time: Date.now() });
    } else {
      io.to(roomId).emit('countdown', { val });
    }
  }, 1000);
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🏎️  Racing server on http://localhost:${PORT}`));
