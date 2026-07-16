import { createGameServer } from './server';

const port = Number(process.env.PORT) || 8080;

createGameServer().listen(port, () => {
  console.log(`bomber server en écoute sur :${port}`);
});
