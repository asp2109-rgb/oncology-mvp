declare module "word-extractor" {
  class WordExtractor {
    extract(input: string): Promise<{ getBody: () => string }>;
  }

  export = WordExtractor;
}
