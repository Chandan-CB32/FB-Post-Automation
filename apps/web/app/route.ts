import { forwardNextToNode } from '../src/next-adapter';
import { handleRequest } from '../src/server';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  return forwardNextToNode(request, handleRequest);
}
