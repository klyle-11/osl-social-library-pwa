// Reads the files out of a zip (an EPUB is one), with no library: the central
// directory says where each file is, and the browser's DecompressionStream
// inflates it. Enough for EPUBs; not zip64, not encrypted entries.

export interface ZipEntry {
    name: string;
    method: number;          // 0 stored, 8 deflate
    compressedSize: number;
    size: number;
    offset: number;          // of the local header
    encrypted: boolean;
}

export class Zip {
    readonly entries = new Map<string, ZipEntry>();
    private readonly view: DataView;

    constructor(private readonly bytes: Uint8Array) {
        this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        const end = this.findEnd();
        const count = this.view.getUint16(end + 10, true);
        let at = this.view.getUint32(end + 16, true);
        if (at === 0xffffffff) throw new Error("This file is too large to open here (zip64).");
        const names = new TextDecoder();
        for (let i = 0; i < count; i++) {
            if (this.view.getUint32(at, true) !== 0x02014b50) throw new Error("This file is damaged (zip directory).");
            const flags = this.view.getUint16(at + 8, true);
            const nameLen = this.view.getUint16(at + 28, true);
            const extraLen = this.view.getUint16(at + 30, true);
            const commentLen = this.view.getUint16(at + 32, true);
            const name = names.decode(bytes.subarray(at + 46, at + 46 + nameLen));
            this.entries.set(name, {
                name,
                method: this.view.getUint16(at + 10, true),
                compressedSize: this.view.getUint32(at + 20, true),
                size: this.view.getUint32(at + 24, true),
                offset: this.view.getUint32(at + 42, true),
                encrypted: (flags & 1) !== 0
            });
            at += 46 + nameLen + extraLen + commentLen;
        }
    }

    has(name: string): boolean {
        return this.entries.has(name);
    }

    async read(name: string): Promise<Uint8Array> {
        const e = this.entries.get(name);
        if (!e) throw new Error(`missing from the file: ${name}`);
        if (e.encrypted) throw new Error("This file is locked (encrypted) and can't be opened here.");
        if (this.view.getUint32(e.offset, true) !== 0x04034b50) throw new Error("This file is damaged (zip entry).");
        const start = e.offset + 30 + this.view.getUint16(e.offset + 26, true) + this.view.getUint16(e.offset + 28, true);
        const raw = this.bytes.subarray(start, start + e.compressedSize);
        if (e.method === 0) return raw;
        if (e.method !== 8) throw new Error(`This file uses a compression the reader doesn't know (${e.method}).`);
        const stream = new Blob([raw as BlobPart]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
        return new Uint8Array(await new Response(stream).arrayBuffer());
    }

    async text(name: string): Promise<string> {
        return new TextDecoder().decode(await this.read(name));
    }

    // the end-of-central-directory record: the last 22 bytes, unless there's a comment after it
    private findEnd(): number {
        const min = Math.max(0, this.bytes.length - 22 - 0xffff);
        for (let at = this.bytes.length - 22; at >= min; at--) {
            if (this.view.getUint32(at, true) === 0x06054b50) return at;
        }
        throw new Error("This isn't a zip file, or it's cut short.");
    }
}
