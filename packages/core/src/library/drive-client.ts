import crypto from 'node:crypto';
import type { GoogleServiceAccountKey, DriveFileMetadata } from '../types/library.js';

export class DriveSafetyScopeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DriveSafetyScopeError';
  }
}

export class DriveApiError extends Error {
  public status?: number;
  public code?: string;

  constructor(message: string, status?: number, code?: string) {
    super(message);
    this.name = 'DriveApiError';
    this.status = status;
    this.code = code;
  }
}

/**
 * Extracts a Google Drive Folder ID from a raw ID or full Drive folder URL.
 */
export function extractDriveFolderId(input: string): string {
  if (!input || typeof input !== 'string') {
    throw new Error('Google Drive folder ID or URL is required.');
  }

  const trimmed = input.trim();

  // Match: https://drive.google.com/drive/folders/1a2b3c4d5e6f... or /u/0/folders/...
  const folderUrlMatch = trimmed.match(/\/folders\/([a-zA-Z0-9_-]+)/);
  if (folderUrlMatch && folderUrlMatch[1]) {
    return folderUrlMatch[1];
  }

  // Match: https://drive.google.com/open?id=1a2b3c4d5e6f...
  const queryMatch = trimmed.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (queryMatch && queryMatch[1]) {
    return queryMatch[1];
  }

  // If already a clean folder ID (Drive IDs are typically 25-45 base64url characters)
  if (/^[a-zA-Z0-9_-]{10,}$/.test(trimmed)) {
    return trimmed;
  }

  throw new Error(`Invalid Google Drive folder ID or URL format: "${trimmed}".`);
}

/**
 * Validates and parses a raw service account JSON string.
 */
export function parseServiceAccountKey(rawJson: string): GoogleServiceAccountKey {
  try {
    const parsed = typeof rawJson === 'string' ? JSON.parse(rawJson) : rawJson;
    if (!parsed || typeof parsed !== 'object') {
      throw new Error('Parsed service account is not a valid JSON object.');
    }
    if (!parsed.client_email || typeof parsed.client_email !== 'string') {
      throw new Error('Service account JSON is missing "client_email".');
    }
    if (!parsed.private_key || typeof parsed.private_key !== 'string') {
      throw new Error('Service account JSON is missing "private_key".');
    }
    return parsed as GoogleServiceAccountKey;
  } catch (err: any) {
    throw new Error(`Invalid Google Service Account JSON: ${err.message}`);
  }
}

export interface DriveClientOptions {
  credentials: GoogleServiceAccountKey;
  libraryFolderId: string;
  postedFolderId?: string;
  fetchFn?: typeof fetch;
}

/**
 * Enterprise Google Drive client wrapper using Google Service Account JWT.
 * Strict Safety Scope: acts only on files in libraryFolderId or postedFolderId.
 * Strict Guarantee: NEVER calls permanent delete API or empty-trash.
 */
export class GoogleDriveClient {
  private credentials: GoogleServiceAccountKey;
  private libraryFolderId: string;
  private postedFolderId?: string;
  private accessToken: string | null = null;
  private tokenExpiresAt: number = 0;
  private fetchFn: typeof fetch;

  constructor(options: DriveClientOptions) {
    this.credentials = options.credentials;
    this.libraryFolderId = extractDriveFolderId(options.libraryFolderId);
    if (options.postedFolderId) {
      this.postedFolderId = extractDriveFolderId(options.postedFolderId);
    }
    this.fetchFn = options.fetchFn || fetch.bind(globalThis);
  }

  public getServiceAccountEmail(): string {
    return this.credentials.client_email;
  }

  public getLibraryFolderId(): string {
    return this.libraryFolderId;
  }

  public getPostedFolderId(): string | undefined {
    return this.postedFolderId;
  }

  public setPostedFolderId(folderId: string): void {
    this.postedFolderId = extractDriveFolderId(folderId);
  }

  /**
   * Generates a signed OAuth2 JWT for Google Drive API.
   */
  private createSignedJwt(): string {
    const now = Math.floor(Date.now() / 1000);
    const header = { alg: 'RS256', typ: 'JWT' };
    const claim = {
      iss: this.credentials.client_email,
      scope: 'https://www.googleapis.com/auth/drive',
      aud: 'https://oauth2.googleapis.com/token',
      exp: now + 3600,
      iat: now,
    };

    const base64UrlEncode = (input: string | Buffer) => {
      const buf = Buffer.isBuffer(input) ? input : Buffer.from(input, 'utf8');
      return buf
        .toString('base64')
        .replace(/=/g, '')
        .replace(/\+/g, '-')
        .replace(/\//g, '_');
    };

    const encodedHeader = base64UrlEncode(JSON.stringify(header));
    const encodedClaim = base64UrlEncode(JSON.stringify(claim));
    const unsignedToken = `${encodedHeader}.${encodedClaim}`;

    const signer = crypto.createSign('RSA-SHA256');
    signer.update(unsignedToken);
    signer.end();
    const signature = signer.sign(this.credentials.private_key);
    const encodedSignature = base64UrlEncode(signature);

    return `${unsignedToken}.${encodedSignature}`;
  }

  /**
   * Acquires or caches an active Google OAuth2 bearer access token.
   */
  public async getAccessToken(): Promise<string> {
    const nowMs = Date.now();
    if (this.accessToken && this.tokenExpiresAt > nowMs + 60000) {
      return this.accessToken;
    }

    const assertion = this.createSignedJwt();
    const body = new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    });

    const res = await this.fetchFn('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });

    if (!res.ok) {
      const errText = await res.text();
      let parsedErr: any;
      try {
        parsedErr = JSON.parse(errText);
      } catch {}
      const desc = parsedErr?.error_description || parsedErr?.error || errText;
      throw new DriveApiError(`Google OAuth2 Token Exchange Failed (${res.status}): ${desc}`, res.status);
    }

    const data = (await res.json()) as { access_token: string; expires_in: number };
    this.accessToken = data.access_token;
    this.tokenExpiresAt = nowMs + (data.expires_in || 3600) * 1000;
    return this.accessToken;
  }

  /**
   * Fetch with exponential backoff on HTTP 429 and 5xx errors.
   */
  private async fetchWithRetry(url: string, init: RequestInit, retries = 3): Promise<Response> {
    let attempt = 0;
    let delayMs = 500;

    while (attempt <= retries) {
      attempt++;
      try {
        const token = await this.getAccessToken();
        const headers = new Headers(init.headers || {});
        headers.set('Authorization', `Bearer ${token}`);

        const response = await this.fetchFn(url, { ...init, headers });

        if (response.status === 429 || (response.status >= 500 && response.status <= 599)) {
          if (attempt <= retries) {
            await new Promise((resolve) => setTimeout(resolve, delayMs));
            delayMs *= 2;
            continue;
          }
        }

        return response;
      } catch (err: any) {
        if (attempt <= retries) {
          await new Promise((resolve) => setTimeout(resolve, delayMs));
          delayMs *= 2;
          continue;
        }
        throw err;
      }
    }

    throw new Error(`Request to ${url} failed after ${retries} retries.`);
  }

  /**
   * Verifies that the file belongs to the allowed safety scope (libraryFolderId or postedFolderId).
   */
  public verifySafetyScope(file: { id: string; parents?: string[] }): void {
    const parents = file.parents || [];
    const allowed = [this.libraryFolderId];
    if (this.postedFolderId) {
      allowed.push(this.postedFolderId);
    }

    const isInsideScope = parents.some((p) => allowed.includes(p));
    if (!isInsideScope) {
      throw new DriveSafetyScopeError(
        `Safety Scope Violation: File "${file.id}" with parents [${parents.join(
          ', '
        )}] is outside library folder "${this.libraryFolderId}" (or posted folder "${this.postedFolderId || 'none'}"). Action refused.`
      );
    }
  }

  /**
   * Fetches metadata for a single file.
   */
  public async getFileMetadata(fileId: string): Promise<DriveFileMetadata> {
    const url = `https://www.googleapis.com/drive/v3/files/${fileId}?fields=id,name,mimeType,md5Checksum,modifiedTime,parents,size,trashed&supportsAllDrives=true`;
    const res = await this.fetchWithRetry(url, { method: 'GET' });

    if (!res.ok) {
      const errText = await res.text();
      this.handleApiError(res.status, errText, `getFileMetadata(${fileId})`);
    }

    const data = (await res.json()) as DriveFileMetadata;
    return data;
  }

  /**
   * Lists image files in a folder (jpg, jpeg, png, webp), handling pagination for 1000+ files.
   */
  public async listFilesInFolder(folderId?: string): Promise<DriveFileMetadata[]> {
    const targetFolder = folderId ? extractDriveFolderId(folderId) : this.libraryFolderId;
    const query = `'${targetFolder}' in parents and trashed = false and (mimeType = 'image/jpeg' or mimeType = 'image/png' or mimeType = 'image/webp')`;

    let files: DriveFileMetadata[] = [];
    let pageToken: string | undefined = undefined;

    do {
      const params = new URLSearchParams({
        q: query,
        pageSize: '1000',
        fields: 'nextPageToken,files(id,name,mimeType,md5Checksum,modifiedTime,parents,size,trashed)',
        supportsAllDrives: 'true',
        includeItemsFromAllDrives: 'true',
      });
      if (pageToken) {
        params.set('pageToken', pageToken);
      }

      const url = `https://www.googleapis.com/drive/v3/files?${params.toString()}`;
      const res = await this.fetchWithRetry(url, { method: 'GET' });

      if (!res.ok) {
        const errText = await res.text();
        this.handleApiError(res.status, errText, `listFilesInFolder(${targetFolder})`);
      }

      const data = (await res.json()) as { files?: DriveFileMetadata[]; nextPageToken?: string };
      if (data.files && Array.isArray(data.files)) {
        files = files.concat(data.files);
      }
      pageToken = data.nextPageToken;
    } while (pageToken);

    return files;
  }

  /**
   * Downloads the raw binary bytes of a file as a Buffer.
   */
  public async downloadFileBuffer(fileId: string): Promise<Buffer> {
    const meta = await this.getFileMetadata(fileId);
    this.verifySafetyScope(meta);

    const url = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media&supportsAllDrives=true`;
    const res = await this.fetchWithRetry(url, { method: 'GET' });

    if (!res.ok) {
      const errText = await res.text();
      this.handleApiError(res.status, errText, `downloadFileBuffer(${fileId})`);
    }

    const arrayBuf = await res.arrayBuffer();
    return Buffer.from(arrayBuf);
  }

  /**
   * Moves a file from source folder to target folder.
   */
  public async moveFile(fileId: string, sourceFolderId: string, targetFolderId: string): Promise<DriveFileMetadata> {
    const meta = await this.getFileMetadata(fileId);
    this.verifySafetyScope(meta);

    const cleanSource = extractDriveFolderId(sourceFolderId);
    const cleanTarget = extractDriveFolderId(targetFolderId);

    const params = new URLSearchParams({
      addParents: cleanTarget,
      removeParents: cleanSource,
      fields: 'id,name,parents',
      supportsAllDrives: 'true',
    });

    const url = `https://www.googleapis.com/drive/v3/files/${fileId}?${params.toString()}`;
    const res = await this.fetchWithRetry(url, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });

    if (!res.ok) {
      const errText = await res.text();
      this.handleApiError(res.status, errText, `moveFile(${fileId})`);
    }

    return (await res.json()) as DriveFileMetadata;
  }

  /**
   * Moves file to Google Drive Trash (soft-delete). NEVER permanently deletes.
   */
  public async trashFile(fileId: string): Promise<DriveFileMetadata> {
    const meta = await this.getFileMetadata(fileId);
    this.verifySafetyScope(meta);

    const url = `https://www.googleapis.com/drive/v3/files/${fileId}?fields=id,trashed&supportsAllDrives=true`;
    const res = await this.fetchWithRetry(url, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ trashed: true }),
    });

    if (!res.ok) {
      const errText = await res.text();
      this.handleApiError(res.status, errText, `trashFile(${fileId})`);
    }

    return (await res.json()) as DriveFileMetadata;
  }

  /**
   * Finds or creates a "Posted" subfolder inside the configured library folder.
   */
  public async getOrCreatePostedFolder(libraryFolderId?: string): Promise<string> {
    const parentFolder = libraryFolderId ? extractDriveFolderId(libraryFolderId) : this.libraryFolderId;

    // Search for existing subfolder named 'Posted'
    const q = `'${parentFolder}' in parents and name = 'Posted' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;
    const searchUrl = `https://www.googleapis.com/drive/v3/files?${new URLSearchParams({
      q,
      fields: 'files(id,name)',
      supportsAllDrives: 'true',
    }).toString()}`;

    const res = await this.fetchWithRetry(searchUrl, { method: 'GET' });
    if (!res.ok) {
      const errText = await res.text();
      this.handleApiError(res.status, errText, 'getOrCreatePostedFolder (search)');
    }

    const searchData = (await res.json()) as { files?: { id: string }[] };
    if (searchData.files && searchData.files.length > 0) {
      const existingId = searchData.files[0].id;
      this.setPostedFolderId(existingId);
      return existingId;
    }

    // Create 'Posted' subfolder
    const createUrl = 'https://www.googleapis.com/drive/v3/files?fields=id,name,parents&supportsAllDrives=true';
    const createRes = await this.fetchWithRetry(createUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Posted',
        mimeType: 'application/vnd.google-apps.folder',
        parents: [parentFolder],
      }),
    });

    if (!createRes.ok) {
      const errText = await createRes.text();
      this.handleApiError(createRes.status, errText, 'getOrCreatePostedFolder (create)');
    }

    const createdData = (await createRes.json()) as { id: string };
    this.setPostedFolderId(createdData.id);
    return createdData.id;
  }

  /**
   * Translates common Google Drive API errors into actionable diagnostic messages.
   */
  private handleApiError(status: number, errBody: string, context: string): never {
    let message = `Drive API error (${status}) in ${context}: ${errBody}`;
    try {
      const parsed = JSON.parse(errBody);
      const firstError = parsed.error?.errors?.[0] || parsed.error;
      const reason = firstError?.reason;
      const desc = firstError?.message || parsed.error?.message;

      if (status === 404 || reason === 'notFound') {
        message = `Google Drive Folder or File not found (${context}). Please verify the folder ID is correct and shared with "${this.credentials.client_email}".`;
      } else if (status === 403) {
        if (reason === 'insufficientPermissions' || desc?.includes('permission')) {
          message = `Access denied (${context}). Please share the Drive folder with service account "${this.credentials.client_email}" with "Editor" or "Viewer" permissions.`;
        } else if (reason === 'accessNotConfigured' || desc?.includes('API has not been used')) {
          message = `Google Drive API is not enabled in your Google Cloud Project. Please enable the "Google Drive API" in the Google Cloud Console.`;
        } else {
          message = `Google Drive access forbidden (${context}): ${desc || reason}`;
        }
      } else if (desc) {
        message = `Drive API error (${status}): ${desc}`;
      }
    } catch {}

    throw new DriveApiError(message, status);
  }
}
