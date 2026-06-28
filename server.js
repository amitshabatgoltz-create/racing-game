const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

const MAX_PLAYERS = 5;
const room = {
  players: {},
  state: 'waiting',
  winner: null,
  raceStart: null
};

// Start positions around the oval
const startPositions = [
  {x:90, z:0}, {x:86, z:3}, {x:86, z:-3}, {x:82, z:5}, {x:82, z:-5}
];
const startTs = [0.003, 0.008, 0.013, 0.018, 0.023];

io.on('connection', (socket) => {
  const playerCount = Object.keys(room.players).length;
  if(playerCount >= MAX_PLAYERS){
    socket.emit('room_full');
    return;
  }

  socket.on('join', (data) => {
    const num = Object.keys(room.players).length + 1;
    const sp = startPositions[num-1];
    room.players[socket.id] = {
      id: socket.id,
      num,
      name: data.name || 'Player '+num,
      ready: false,
      x: sp.x, z: sp.z,
      angle: Math.PI/2,
      speed: 0,
      lap: 1,
      t: startTs[num-1],
      finished: false,
      bestLap: null,
      wins: data.wins || 0
    };

    socket.join('main');
    socket.emit('joined', {
      yourId: socket.id,
      yourNum: num,
      players: room.players,
      roomState: room.state
    });
    socket.to('main').emit('player_joined', room.players[socket.id]);
    console.log(`${data.name} joined as P${num}. Total: ${num}`);
  });

  socket.on('player_ready', () => {
    if(!room.players[socket.id]) return;
    room.players[socket.id].ready = true;
    io.to('main').emit('player_ready', { id: socket.id });

    const players = Object.values(room.players);
    const allReady = players.length >= 2 && players.every(p => p.ready);
    if(allReady && room.state === 'waiting'){
      room.state = 'countdown';
      startCountdown();
    }
  });

  socket.on('update', (data) => {
    if(!room.players[socket.id]) return;
    Object.assign(room.players[socket.id], data);
    socket.to('main').emit('player_update', { id: socket.id, ...data });
  });

  socket.on('finished', (data) => {
    if(!room.players[socket.id]) return;
    room.players[socket.id].finished = true;
    if(!room.winner){
      room.winner = socket.id;
      io.to('main').emit('race_finished', {
        winnerId: socket.id,
        winnerName: room.players[socket.id].name,
        time: data.time
      });
    }
  });

  socket.on('disconnect', () => {
    if(!room.players[socket.id]) return;
    const name = room.players[socket.id].name;
    delete room.players[socket.id];
    io.to('main').emit('player_left', { id: socket.id, name });
    // Reset if everyone leaves
    if(Object.keys(room.players).length === 0){
      room.state = 'waiting';
      room.winner = null;
    }
    console.log(`${name} disconnected`);
  });
});

function startCountdown(){
  let val = 3;
  io.to('main').emit('countdown', { val });
  const interval = setInterval(() => {
    val--;
    if(val <= 0){
      clearInterval(interval);
      room.state = 'racing';
      room.raceStart = Date.now();
      io.to('main').emit('race_start', { time: room.raceStart });
    } else {
      io.to('main').emit('countdown', { val });
    }
  }, 1000);
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🏎️  Racing server on http://localhost:${PORT}`));
