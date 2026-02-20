import fs from "node:fs";
import path from "node:path";
import QRCode from "qrcode";

const appUrl = process.env.PUBLIC_DEMO_URL ?? "https://example.com/demo";
const docsUrl = process.env.PUBLIC_DOCS_URL ?? "https://example.com/docs";

const outputDir = path.join(process.cwd(), "public", "qr");
fs.mkdirSync(outputDir, { recursive: true });

async function main() {
  await QRCode.toFile(path.join(outputDir, "qr-demo.png"), appUrl, {
    width: 512,
    margin: 2,
    color: {
      dark: "#0B2A4A",
      light: "#FFFFFF",
    },
  });

  await QRCode.toFile(path.join(outputDir, "qr-docs.png"), docsUrl, {
    width: 512,
    margin: 2,
    color: {
      dark: "#083F5A",
      light: "#FFFFFF",
    },
  });

  console.log("QR files generated");
  console.log(path.join(outputDir, "qr-demo.png"));
  console.log(path.join(outputDir, "qr-docs.png"));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
