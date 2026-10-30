# FIST: Ultra Edition — notas para o Claude

## Versão e release

Sempre que fizer merge de um PR em `main`, a mudança precisa subir a versão para
gerar um release (o workflow `.github/workflows/release.yml` só publica quando a
versão em `system.json` muda).

- Antes do merge, inclua no PR o bump de versão (semver: patch para correções,
  minor para funcionalidades novas, major para mudanças incompatíveis).
- Atualize juntos:
  - `"version"` em `system.json`
  - `"download"` em `system.json` (`.../releases/download/vX.Y.Z/fist.zip`)
  - `"version"` em `package.json`
