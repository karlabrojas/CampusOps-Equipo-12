import * as Crypto from "expo-crypto";
import * as FileSystem from "expo-file-system/legacy";

export type PersistedAttachment = Readonly<{
  localUri: string;
  sha256: string;
  sizeBytes: number;
}>;

export interface AttachmentFileStore {
  persist(sourceUri: string, operationId: string, attachmentId: string): Promise<PersistedAttachment>;
  verify(uri: string, expectedSha256: string, expectedSizeBytes: number): Promise<boolean>;
  remove(uri: string): Promise<void>;
  removeUnreferenced(referencedUris: ReadonlySet<string>): Promise<void>;
}

function safeSegment(value: string): string {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(value)) {
    throw new Error("Attachment and operation IDs must be safe path segments");
  }
  return value;
}

export class ExpoAttachmentFileStore implements AttachmentFileStore {
  private readonly root: string;

  constructor(documentDirectory = FileSystem.documentDirectory) {
    if (!documentDirectory) {
      throw new Error("Persistent document storage is unavailable");
    }
    this.root = `${documentDirectory}campusops/evidence/`;
  }

  async persist(
    sourceUri: string,
    operationId: string,
    attachmentId: string,
  ): Promise<PersistedAttachment> {
    if (!sourceUri.trim()) {
      throw new Error("A source URI is required for an attachment");
    }
    const operationSegment = safeSegment(operationId);
    const attachmentSegment = safeSegment(attachmentId);
    const directory = `${this.root}${operationSegment}/`;
    const targetUri = `${directory}${attachmentSegment}`;
    const temporaryUri = `${targetUri}.staged`;

    await FileSystem.makeDirectoryAsync(directory, { intermediates: true });
    await FileSystem.deleteAsync(temporaryUri, { idempotent: true });
    try {
      await FileSystem.copyAsync({ from: sourceUri, to: temporaryUri });
      const encoded = await FileSystem.readAsStringAsync(temporaryUri, {
        encoding: FileSystem.EncodingType.Base64,
      });
      const sha256 = await Crypto.digestStringAsync(
        Crypto.CryptoDigestAlgorithm.SHA256,
        encoded,
      );
      const info = await FileSystem.getInfoAsync(temporaryUri);
      if (!info.exists || info.isDirectory || info.size === undefined) {
        throw new Error("Staged attachment is missing or invalid");
      }
      await FileSystem.deleteAsync(targetUri, { idempotent: true });
      await FileSystem.moveAsync({ from: temporaryUri, to: targetUri });
      return { localUri: targetUri, sha256, sizeBytes: info.size };
    } catch (error) {
      await FileSystem.deleteAsync(temporaryUri, { idempotent: true });
      throw error;
    }
  }

  async verify(
    uri: string,
    expectedSha256: string,
    expectedSizeBytes: number,
  ): Promise<boolean> {
    const info = await FileSystem.getInfoAsync(uri);
    if (
      !info.exists ||
      info.isDirectory ||
      info.size !== expectedSizeBytes
    ) {
      return false;
    }
    const encoded = await FileSystem.readAsStringAsync(uri, {
      encoding: FileSystem.EncodingType.Base64,
    });
    const sha256 = await Crypto.digestStringAsync(
      Crypto.CryptoDigestAlgorithm.SHA256,
      encoded,
    );
    return sha256 === expectedSha256;
  }

  async remove(uri: string): Promise<void> {
    await FileSystem.deleteAsync(uri, { idempotent: true });
  }

  async removeUnreferenced(
    referencedUris: ReadonlySet<string>,
  ): Promise<void> {
    const rootInfo = await FileSystem.getInfoAsync(this.root);
    if (!rootInfo.exists) return;
    const operationDirectories = await FileSystem.readDirectoryAsync(this.root);
    for (const operationId of operationDirectories) {
      const directory = `${this.root}${operationId}/`;
      const info = await FileSystem.getInfoAsync(directory);
      if (!info.exists || !info.isDirectory) continue;
      const entries = await FileSystem.readDirectoryAsync(directory);
      for (const filename of entries) {
        const uri = `${directory}${filename}`;
        if (!referencedUris.has(uri)) {
          await FileSystem.deleteAsync(uri, { idempotent: true });
        }
      }
      const remaining = await FileSystem.readDirectoryAsync(directory);
      if (remaining.length === 0) {
        await FileSystem.deleteAsync(directory, { idempotent: true });
      }
    }
  }
}
