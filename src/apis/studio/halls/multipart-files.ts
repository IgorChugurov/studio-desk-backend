import { createWriteStream } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import busboy from 'busboy';
import type { Request } from 'express';
import { ApiError } from '../../../common/errors/api-error.js';
import { VIDEO_MAX_BYTES } from './file-type.js';

export interface UploadedPart {
  path: string;
  size: number;
  truncated: boolean;
}

/** Reads every `files` part onto disk. The caller deletes the paths. */
export function readUploadedFiles(request: Request): Promise<UploadedPart[]> {
  return new Promise((resolve, reject) => {
    let parser: ReturnType<typeof busboy>;
    try {
      parser = busboy({
        headers: request.headers,
        limits: { fileSize: VIDEO_MAX_BYTES },
      });
    } catch {
      reject(expectedMultipart());
      return;
    }

    const pending: Promise<UploadedPart | undefined>[] = [];
    const directories: string[] = [];
    parser.on('file', (name, stream) => {
      if (name !== 'files') {
        stream.resume();
        return;
      }
      pending.push(writePart(stream, directories));
    });
    parser.on('error', () => reject(expectedMultipart()));
    parser.on('close', () => {
      Promise.all(pending).then(
        (parts) => resolve(parts.filter((part) => part !== undefined)),
        async (error: unknown) => {
          await Promise.all(
            directories.map((directory) =>
              rm(directory, { recursive: true, force: true }),
            ),
          );
          reject(error instanceof Error ? error : expectedMultipart());
        },
      );
    });
    request.pipe(parser);
  });
}

async function writePart(
  stream: NodeJS.ReadableStream & { truncated?: boolean },
  directories: string[],
): Promise<UploadedPart> {
  const directory = await mkdtemp(join(tmpdir(), 'studio-desk-upload-'));
  directories.push(directory);
  const path = join(directory, 'part');
  let size = 0;
  const counter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      size += chunk.length;
      callback(null, chunk);
    },
  });
  await pipeline(stream, counter, createWriteStream(path));
  return { path, size, truncated: stream.truncated === true };
}

function expectedMultipart() {
  return new ApiError({
    statusCode: 400,
    code: 'BAD_REQUEST',
    message: 'Expected multipart form data',
  });
}
