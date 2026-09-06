import { readdir } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const artRoot = path.resolve("public/art");

async function visit(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  await Promise.all(
    entries.map(async (entry) => {
      const source = path.join(directory, entry.name);
      if (entry.isDirectory()) return visit(source);
      if (!entry.name.endsWith(".png") || entry.name.includes("opaque-draft"))
        return;

      await Promise.all(
        [
          [256, source.replace(/\.png$/i, "@1x.webp")],
          [512, source.replace(/\.png$/i, "@2x.webp")],
        ].map(([size, output]) =>
          sharp(source)
            .resize({
              width: Number(size),
              height: Number(size),
              fit: "inside",
              withoutEnlargement: true,
            })
            .webp({ quality: 86, alphaQuality: 95, smartSubsample: true })
            .toFile(String(output)),
        ),
      );
    }),
  );
}

await visit(artRoot);
