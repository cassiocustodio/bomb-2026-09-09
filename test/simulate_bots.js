'use strict';
const { spawn } = require('child_process');
const path = require('path');
const { io } = require('socket.io-client');

const PORT = 4124;
const URL = 'http://localhost:' + PORT;
function wait(ms){ return new Promise(r => setTimeout(r, ms)); }
function ok(msg){ console.log('[OK]', msg); }
function fail(msg){ console.error('[FAIL]', msg); process.exitCode = 1; }

async function main(){
  const serverProc = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    env: Object.assign({}, process.env, { PORT: String(PORT) }),
    stdio: ['ignore', 'pipe', 'pipe']
  });
  await wait(700);

  const a = io(URL, { transports: ['websocket'] });
  await new Promise(res => a.on('connect', res));

  let state = null;
  a.on('state', s => { state = s; });

  const createRes = await new Promise(res => a.emit('createRoom', { maxPlayers: 4 }, res));
  ok('sala de 4 criada sozinho: ' + createRes.code);
  a.emit('startGame');
  await wait(400);

  if(!state){ fail('sem estado recebido'); }
  else {
    ok('entidades na partida: ' + state.entities.length + ' (esperado 4: 1 humano + 3 bots)');
    if(state.entities.length !== 4) fail('deveria ter preenchido com bots até 4');
    const bots = state.entities.filter(e => e.isBot);
    ok('bots detectados: ' + bots.length);
    if(bots.length !== 3) fail('esperava 3 bots');
  }

  // deixa rodar alguns segundos e confere que os bots se mexeram (IA ativa)
  const initialPositions = state.entities.filter(e=>e.isBot).map(e => ({x:e.x, y:e.y}));
  await wait(3000);
  const laterBots = state.entities.filter(e=>e.isBot);
  let anyMoved = false;
  laterBots.forEach((b, i) => {
    const moved = Math.abs(b.x - initialPositions[i].x) > 0.1 || Math.abs(b.y - initialPositions[i].y) > 0.1;
    if(moved) anyMoved = true;
  });
  if(anyMoved) ok('bots se moveram sozinhos (IA ativa no servidor)');
  else fail('nenhum bot se moveu em 3s — IA pode estar travada');

  a.close(); serverProc.kill();
  setTimeout(() => process.exit(), 300);
}
main().catch(e => { console.error(e); process.exit(1); });
