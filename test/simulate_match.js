'use strict';
// Teste de ponta a ponta: sobe o servidor real, conecta 2 clientes via
// socket.io-client, cria sala, entra, começa a partida, manda input e bomba,
// e confere que o estado do servidor reage como esperado.

const { spawn } = require('child_process');
const path = require('path');
const { io } = require('socket.io-client');

const PORT = 4123;
const URL = 'http://localhost:' + PORT;

function log(...args){ console.log('[test]', ...args); }
function fail(msg){ console.error('[FAIL]', msg); process.exitCode = 1; }
function ok(msg){ console.log('[OK]', msg); }

function wait(ms){ return new Promise(r => setTimeout(r, ms)); }

async function main(){
  const serverProc = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    env: Object.assign({}, process.env, { PORT: String(PORT) }),
    stdio: ['ignore', 'pipe', 'pipe']
  });
  serverProc.stdout.on('data', d => log('server stdout:', d.toString().trim()));
  serverProc.stderr.on('data', d => log('server stderr:', d.toString().trim()));

  await wait(700); // dá tempo do servidor subir

  const a = io(URL, { transports: ['websocket'] });
  const b = io(URL, { transports: ['websocket'] });

  let aState = null, bState = null;
  a.on('state', s => { aState = s; });
  b.on('state', s => { bState = s; });

  let aGameStart = null, bGameOver = null, aGameOver = null;
  a.on('gameStart', d => { aGameStart = d; });
  a.on('gameOver', d => { aGameOver = d; });
  b.on('gameOver', d => { bGameOver = d; });

  await new Promise(res => a.on('connect', res));
  await new Promise(res => b.on('connect', res));
  ok('ambos os clientes conectaram: a=' + a.id + ' b=' + b.id);

  // ---- criar e entrar na sala ----
  const createRes = await new Promise(res => a.emit('createRoom', { maxPlayers: 2 }, res));
  if(!createRes || !createRes.ok){ fail('createRoom falhou: ' + JSON.stringify(createRes)); return cleanup(); }
  ok('sala criada: ' + createRes.code + ' (host=' + createRes.isHost + ')');

  const joinRes = await new Promise(res => b.emit('joinRoom', { code: createRes.code }, res));
  if(!joinRes || !joinRes.ok){ fail('joinRoom falhou: ' + JSON.stringify(joinRes)); return cleanup(); }
  ok('cliente B entrou na sala (isHost=' + joinRes.isHost + ', esperado false)');
  if(joinRes.isHost !== false) fail('B não deveria ser host');

  // sala cheia (maxPlayers=2, 2 conectados) — testa que uma 3ª conexão é rejeitada
  const c = io(URL, { transports: ['websocket'] });
  await new Promise(res => c.on('connect', res));
  const joinFullRes = await new Promise(res => c.emit('joinRoom', { code: createRes.code }, res));
  if(joinFullRes && joinFullRes.ok) fail('sala cheia deveria recusar a 3ª conexão');
  else ok('sala cheia corretamente recusou: ' + (joinFullRes && joinFullRes.error));
  c.close();

  // ---- começar a partida ----
  a.emit('startGame');
  await wait(300);
  if(!aGameStart){ fail('gameStart nunca chegou'); return cleanup(); }
  ok('partida começou: grid ' + aGameStart.cols + 'x' + aGameStart.rows + ', roundTime=' + aGameStart.roundTime);

  await wait(200);
  if(!aState || !aState.grid){ fail('nenhum estado recebido com grid'); return cleanup(); }
  ok('primeiro estado recebido, entidades: ' + aState.entities.length + ' (esperado 2, sem bots pois sala estava cheia)');
  if(aState.entities.length !== 2) fail('esperava 2 entidades (2 humanos, sala cheia, sem bots)');

  const meInA = aState.entities.find(e => e.id === a.id);
  const startX = meInA.x, startY = meInA.y;
  ok('posição inicial do jogador A: (' + startX + ', ' + startY + ')');

  // ---- mandar input e conferir que a posição muda ----
  a.emit('input', { ix: 1, iy: 0 });
  await wait(600);
  const meInA2 = aState.entities.find(e => e.id === a.id);
  ok('posição após andar: (' + meInA2.x.toFixed(2) + ', ' + meInA2.y.toFixed(2) + ')');
  if(Math.abs(meInA2.x - startX) < 0.05 && Math.abs(meInA2.y - startY) < 0.05){
    fail('jogador A não se moveu depois do input');
  } else {
    ok('movimento server-authoritative funcionando');
  }
  a.emit('input', { ix: 0, iy: 0 });
  await wait(100);

  // ---- colocar bomba e conferir que ela aparece e depois explode ----
  a.emit('placeBomb');
  await wait(150);
  if(!aState.bombs || aState.bombs.length === 0){ fail('bomba não apareceu no estado'); }
  else ok('bomba colocada, timer=' + aState.bombs[0].timer.toFixed(2));

  await wait(4500); // fuse é 4s
  if(aState.bombs.length === 0) ok('bomba explodiu e sumiu da lista, como esperado');
  else fail('bomba ainda na lista depois do fuse — não explodiu?');

  ok('teste concluído sem falhas fatais (ver [FAIL] acima se houver)');
  cleanup();

  function cleanup(){
    a.close(); b.close();
    serverProc.kill();
    setTimeout(() => process.exit(), 300);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
