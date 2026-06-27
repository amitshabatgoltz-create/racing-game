const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

// Game state
const rooms = {};

function createRoom(id) {
  return {
    id,
    players: {},
    state: 'waiting', // waiting | countdown | racing | finished
    countdownVal: 3,
    raceStart: null,
    winner: null
  };
}

const LOBBY = 'main';
rooms[LOBBY] = createRoom(LOBBY);

io.on('connection', (socket) => {
  console.log('Player connected:', socket.id);
  const room = rooms[LOBBY];

  // Assign player number
  const playerCount = Object.keys(room.players).length;
  if (playerCount >= 2) {
    socket.emit('room_full');
    return;
  }

  const playerNum = playerCount + 1;
  room.players[socket.id] = {
    id: socket.id,
    num: playerNum,
    name: 'Player ' + playerNum,
    ready: false,
    // Physics state
    x: playerNum === 1 ? 90 : 87,
    z: 0,
    angle: Math.PI / 2,
    speed: 0,
    lap: 1,
    t: playerNum === 1 ? 0.003 : 0.010,
    finished: false,
    bestLap: null,
    lapStart: 0
  };

  socket.join(LOBBY);
  socket.emit('joined', {
    yourId: socket.id,
    yourNum: playerNum,
    players: room.players,
    roomState: room.state
  });
  socket.to(LOBBY).emit('player_joined', { id: socket.id, num: playerNum });

  console.log(`Player ${playerNum} joined. Total: ${Object.keys(room.players).length}`);

  // Start countdown when 2 players ready
  socket.on('player_ready', () => {
    if (!room.players[socket.id]) return;
    room.players[socket.id].ready = true;
    io.to(LOBBY).emit('player_ready', { id: socket.id });

    const allReady = Object.values(room.players).length === 2 &&
                     Object.values(room.players).every(p => p.ready);
    if (allReady && room.state === 'waiting') {
      room.state = 'countdown';
      startCountdown(room);
    }
  });

  // Receive position update from client
  socket.on('update', (data) => {
    if (!room.players[socket.id]) return;
    Object.assign(room.players[socket.id], data);
    // Broadcast to OTHER player
    socket.to(LOBBY).emit('opponent_update', {
      id: socket.id,
      ...data
    });
  });

  socket.on('lap_complete', (data) => {
    io.to(LOBBY).emit('lap_complete', { id: socket.id, ...data });
  });

  socket.on('finished', (data) => {
    if (!room.players[socket.id]) return;
    room.players[socket.id].finished = true;
    if (!room.winner) {
      room.winner = socket.id;
      io.to(LOBBY).emit('race_finished', {
        winnerId: socket.id,
        winnerNum: room.players[socket.id].num,
        time: data.time
      });
    }
  });

  socket.on('disconnect', () => {
    console.log('Player disconnected:', socket.id);
    if (room.players[socket.id]) {
      const num = room.players[socket.id].num;
      delete room.players[socket.id];
      io.to(LOBBY).emit('player_left', { id: socket.id, num });
      // Reset room
      room.state = 'waiting';
      room.winner = null;
      Object.values(room.players).forEach(p => p.ready = false);
    }
  });
});

function startCountdown(room) {
  let val = 3;
  io.to(room.id).emit('countdown', { val });
  const interval = setInterval(() => {
    val--;
    if (val <= 0) {
      clearInterval(interval);
      room.state = 'racing';
      room.raceStart = Date.now();
      io.to(room.id).emit('race_start', { time: room.raceStart });
    } else {
      io.to(room.id).emit('countdown', { val });
    }
  }, 1000);
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🏎️  Racing server running on http://localhost:${PORT}`);
});
