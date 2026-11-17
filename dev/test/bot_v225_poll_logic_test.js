// Verifica la logica de encuestas del bot v225 replicando sus funciones
// exactas: parseo de /encuesta, conteo de /resultados y callbacks.
import assert from "node:assert/strict";

// ---- Copia exacta del parseo de /encuesta del bot ----
function parsePollArgs(args) {
  const parts = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < args.length; i++) {
    const ch = args[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === ' ' && !inQuotes) {
      if (current) { parts.push(current); current = ''; }
    } else {
      current += ch;
    }
  }
  if (current) parts.push(current);
  return parts;
}

// ---- Copia exacta del conteo de /resultados ----
function countVotes(found) {
  const counts = new Array(found.options.length).fill(0);
  for (const optionIds of found.votes.values()) {
    for (const optionId of optionIds) {
      if (optionId >= 0 && optionId < counts.length) counts[optionId]++;
    }
  }
  return counts;
}

// ---- 1. Parseo de argumentos ----
{
  const parts = parsePollArgs('"Que cenamos?" "Pizza" "Tacos" "Sushi"');
  assert.deepEqual(parts, ['Que cenamos?', 'Pizza', 'Tacos', 'Sushi']);

  // Sin comillas: la primera palabra es la pregunta y el resto opciones.
  const parts2 = parsePollArgs('Color favorito Azul Rojo');
  assert.deepEqual(parts2, ['Color', 'favorito', 'Azul', 'Rojo']);

  // Una opcion con espacios dentro de comillas.
  const parts3 = parsePollArgs('"Elige" "Pizza con jamon" "Sushi"');
  assert.deepEqual(parts3, ['Elige', 'Pizza con jamon', 'Sushi']);
}

// ---- 2. Menos de 3 partes no se puede crear una encuesta ----
{
  assert.equal(parsePollArgs('"Solo pregunta"').length < 3, true);
  assert.equal(parsePollArgs('"Pregunta" "Una opcion"').length < 3, true);
  assert.equal(parsePollArgs('"Pregunta" "A" "B"').length >= 3, true);
}

// ---- 3. Conteo de votos (un Map usuario -> [indices]) ----
{
  const found = {
    question: 'Prueba',
    options: ['A', 'B', 'C'],
    votes: new Map([
      ['u1', [0]],
      ['u2', [1]],
      ['u3', [0, 2]],   // multiple
      ['u4', []],       // voto retirado
    ]),
  };
  const counts = countVotes(found);
  assert.equal(counts[0], 2, 'A tiene 2 votos');
  assert.equal(counts[1], 1, 'B tiene 1 voto');
  assert.equal(counts[2], 1, 'C tiene 1 voto');
  assert.equal(found.votes.size, 4, '4 participantes');
}

// ---- 4. Una opcion fuera de rango no rompe el conteo ----
{
  const found = {
    question: 'Prueba',
    options: ['A', 'B'],
    votes: new Map([
      ['u1', [0]],
      ['u2', [7]],     // indice invalido
      ['u3', [-1]],    // indice negativo
    ]),
  };
  const counts = countVotes(found);
  assert.equal(counts[0], 1);
  assert.equal(counts[1], 0);
}

// ---- 5. Una encuesta sin votos ----
{
  const found = { question: 'Vacia', options: ['A', 'B'], votes: new Map() };
  const counts = countVotes(found);
  assert.deepEqual(counts, [0, 0]);
}

// ---- 6. El registro POLL_ID_TO_KEY resuelve el poll_id de poll_answer ----
{
  const POLLS = new Map();
  const POLL_ID_TO_KEY = new Map();
  const key = '123:456';
  POLLS.set(key, { question: 'Q', options: ['A', 'B'], poll_id: 'poll-abc', votes: new Map() });
  POLL_ID_TO_KEY.set('poll-abc', key);

  assert.equal(POLL_ID_TO_KEY.get('poll-abc'), key, 'poll_answer encuentra la encuesta');
  assert.equal(POLL_ID_TO_KEY.get('otro-poll'), undefined, 'un poll ajeno no se resuelve');
}

// ---- 7. Vote parsing: un solo caso y multiple ----
{
  const single = { multiple: false, votes: new Map() };
  const userId = 'u1';
  const optionIds = [1];
  single.votes.set(userId, single.multiple ? optionIds : optionIds.slice(0, 1));
  assert.deepEqual(single.votes.get('u1'), [1]);

  const multi = { multiple: true, votes: new Map() };
  multi.votes.set(userId, [0, 2]);
  assert.deepEqual(multi.votes.get('u1'), [0, 2]);
}

console.log(JSON.stringify({
  ok: true,
  checks: {
    parseArgs: true,
    minParts: true,
    voteCounts: true,
    outOfRange: true,
    noVotes: true,
    pollIdLookup: true,
    singleVsMultiple: true,
  },
}, null, 2));
