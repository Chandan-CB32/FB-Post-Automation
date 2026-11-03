import { handleRequest } from '../apps/web/dist/server.js';

export default async function handler(req, res) {
  return handleRequest(req, res);
}
