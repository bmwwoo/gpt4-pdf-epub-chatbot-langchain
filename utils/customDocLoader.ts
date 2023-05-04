import { Document } from 'langchain/document';
import { readFile } from 'fs/promises';
import { BaseDocumentLoader } from 'langchain/document_loaders';
import { JSDOM } from 'jsdom';
import Epub from 'epub';
import { extname } from 'path';

export abstract class BufferLoader extends BaseDocumentLoader {
  constructor(public filePathOrBlob: string | Blob) {
    super();
  }

  protected abstract parse(
    raw: Buffer | string,
    metadata: Document['metadata'],
  ): Promise<Document[]>;

  public static isEpubFile(filePath: string): boolean {
    return extname(filePath).toLowerCase() === '.epub';
  }

  public async load(): Promise<Document[]> {
    let buffer: Buffer;
    let metadata: Record<string, string>;
    if (typeof this.filePathOrBlob === 'string') {
      buffer = await readFile(this.filePathOrBlob);
      metadata = { source: this.filePathOrBlob };
    } else {
      buffer = await this.filePathOrBlob
        .arrayBuffer()
        .then((ab) => Buffer.from(ab));
      metadata = { source: 'blob', blobType: this.filePathOrBlob.type };
    }
    if (
      this.filePathOrBlob === 'string' &&
      BufferLoader.isEpubFile(this.filePathOrBlob)
    ) {
      return this.parse(buffer.toString(), metadata);
    } else {
      return this.parse(buffer, metadata);
    }
  }
}

export class CustomPDFLoader extends BufferLoader {
  public async parse(
    raw: Buffer,
    metadata: Document['metadata'],
  ): Promise<Document[]> {
    const { pdf } = await PDFLoaderImports();
    const parsed = await pdf(raw);
    return [
      new Document({
        pageContent: parsed.text,
        metadata: {
          ...metadata,
          pdf_numpages: parsed.numpages,
        },
      }),
    ];
  }
}

async function PDFLoaderImports() {
  try {
    // the main entrypoint has some debug code that we don't want to import
    const { default: pdf } = await import('pdf-parse/lib/pdf-parse.js');
    return { pdf };
  } catch (e) {
    console.error(e);
    throw new Error(
      'Failed to load pdf-parse. Please install it with eg. `npm install pdf-parse`.',
    );
  }
}

export class CustomEPUBLoader extends BufferLoader {
  public async parse(
    rawText: string,
    metadata: Document['metadata'],
  ): Promise<Document[]> {
    console.log('metadata', metadata);
    const epub = new Epub(rawText);
    await epub.parse();
    const text = await extractTextFromEpub(epub);

    return [
      new Document({
        pageContent: text,
        metadata: {
          ...metadata,
        },
      }),
    ];
  }
}

async function extractTextFromEpub(epub: Epub): Promise<string> {
  const textPromises = epub.flow.map(async (chapter) => {
    const content = await new Promise<string>((resolve, reject) => {
      epub.getChapter(chapter.id, (err, data) => {
        if (err) {
          reject(err);
        } else {
          resolve(data);
        }
      });
    });

    const dom = new JSDOM(content);
    return dom.window.document.body.textContent;
  });

  const textArray = await Promise.all(textPromises);
  return textArray.join('\n');
}
