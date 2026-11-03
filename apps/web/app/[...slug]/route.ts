import { forwardNextToNode } from '../../src/next-adapter';
import { handleRequest } from '../../src/server';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  return forwardNextToNode(request, handleRequest);
}

export async function POST(request: Request) {
  return forwardNextToNode(request, handleRequest);
}

export async function PUT(request: Request) {
  return forwardNextToNode(request, handleRequest);
}

export async function DELETE(request: Request) {
  return forwardNextToNode(request, handleRequest);
}

export async function OPTIONS(request: Request) {
  return forwardNextToNode(request, handleRequest);
}
