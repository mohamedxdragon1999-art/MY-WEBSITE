/** detectImage unit tests — magic bytes, not client claims. */
import { detectImage } from "../src/uploads/uploads.controller";

const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

describe("detectImage", () => {
  it("sniffs real formats", () => {
    expect(detectImage(png)).toBe("png");
    expect(detectImage(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]))).toBe("jpg");
    expect(detectImage(Buffer.from("GIF89a................", "ascii"))).toBe("gif");
    const webp = Buffer.alloc(16);
    webp.write("RIFF", 0); webp.write("WEBP", 8);
    expect(detectImage(webp)).toBe("webp");
  });
  it("rejects executables masquerading as images", () => {
    expect(detectImage(Buffer.from("MZ\x90\x00evil-content-here!!"))).toBeNull();
    expect(detectImage(Buffer.from("not an image at all........"))).toBeNull();
    expect(detectImage(Buffer.alloc(0))).toBeNull();
  });
});
