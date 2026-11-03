import { Readable } from 'node:stream';
import http from 'node:http';

export async function forwardNextToNode(
  request: Request,
  handler: (req: http.IncomingMessage, res: http.ServerResponse) => void | Promise<void>
): Promise<Response> {
  const url = new URL(request.url);
  const headersObj: Record<string, string> = {};
  request.headers.forEach((v, k) => {
    headersObj[k.toLowerCase()] = v;
  });

  let bodyBuffer: Buffer = Buffer.alloc(0);
  if (request.body && request.method !== 'GET' && request.method !== 'HEAD') {
    const arrayBuffer = await request.arrayBuffer();
    bodyBuffer = Buffer.from(arrayBuffer);
  }

  const reqStream = Readable.from(bodyBuffer.length > 0 ? [bodyBuffer] : []) as any;
  reqStream.url = url.pathname + url.search;
  reqStream.method = request.method;
  reqStream.headers = headersObj;

  let statusCode = 200;
  const resHeaders = new Headers();
  const chunks: Buffer[] = [];

  return new Promise<Response>((resolve, reject) => {
    const resMock: any = {
      statusCode: 200,
      writeHead(code: number, headers?: any) {
        statusCode = code;
        if (headers) {
          if (Array.isArray(headers)) {
            for (let i = 0; i < headers.length; i += 2) {
              resHeaders.append(headers[i], headers[i + 1]);
            }
          } else {
            for (const [k, v] of Object.entries(headers)) {
              if (k.toLowerCase() === 'set-cookie' && Array.isArray(v)) {
                for (const c of v) resHeaders.append('Set-Cookie', c as string);
              } else if (Array.isArray(v)) {
                resHeaders.set(k, v.join(', '));
              } else {
                resHeaders.set(k, String(v));
              }
            }
          }
        }
        return this;
      },
      setHeader(name: string, value: any) {
        if (name.toLowerCase() === 'set-cookie') {
          if (Array.isArray(value)) {
            for (const c of value) resHeaders.append('Set-Cookie', c as string);
          } else {
            resHeaders.append('Set-Cookie', String(value));
          }
        } else if (Array.isArray(value)) {
          resHeaders.set(name, value.join(', '));
        } else {
          resHeaders.set(name, String(value));
        }
        return this;
      },
      getHeader(name: string) {
        return resHeaders.get(name);
      },
      hasHeader(name: string) {
        return resHeaders.has(name);
      },
      removeHeader(name: string) {
        resHeaders.delete(name);
      },
      write(chunk: any) {
        if (chunk) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        return true;
      },
      end(chunk?: any) {
        if (chunk) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        this.finished = true;
        const totalBuffer = Buffer.concat(chunks);
        resolve(
          new Response(totalBuffer, {
            status: statusCode,
            headers: resHeaders,
          })
        );
      },
    };

    try {
      const result = handler(reqStream, resMock);
      if (result && typeof (result as any).catch === 'function') {
        (result as any).catch(reject);
      }
    } catch (err) {
      reject(err);
    }
  });
}
