# Upstage Document Parse OCR (Grok / kordoc)

kordoc 내장 PP-OCR 과 별도로, 이미지·스캔본은 [Upstage Document Parse](https://console.upstage.ai/docs/capabilities/document-digitization/document-parsing) 에 넘길 수 있다.

엔드포인트: `POST https://api.upstage.ai/v1/document-digitization`  
모델: `document-parse`  
키: **`UPSTAGE_API_KEY` 환경변수만**. 저장소·PR·Grok 플러그인 파일에 키를 넣지 말 것.

## 로컬 키 위치 (이 PC)

- Windows 사용자 환경변수 `UPSTAGE_API_KEY`
- `%USERPROFILE%\.kordoc\secrets.env` (`UPSTAGE_API_KEY=...`)
- 학교/회사 SSL 검사가 있으면 `UPSTAGE_INSECURE_TLS=1` (워처는 기본으로 켬)

## CLI

```bash
# 스캔 PDF — 키가 있으면 ocr 훅이 Upstage 로 연결됨
UPSTAGE_API_KEY=... npx kordoc 스캔.pdf -o 스캔.md

# 이미지 파일 전체 (워처가 쓰는 스크립트)
node scripts/upstage-parse.mjs 안내.png -o 안내.md
```

## 라이브러리

```ts
import { parse, createUpstageOcrProvider, parseFileWithUpstage } from "kordoc"

const r = await parse(pdfBuffer, { ocr: createUpstageOcrProvider() })
const md = await parseFileWithUpstage("안내.png")
```

## Grok MCP

`~/.grok/config.toml` 예시 (키 값은 넣지 않고 확장만):

```toml
[mcp_servers.kordoc]
command = "cmd"
args = ["/c", "npx", "-y", "kordoc", "mcp"]
enabled = true

[mcp_servers.kordoc.env]
UPSTAGE_API_KEY = "${UPSTAGE_API_KEY}"
```

npm 배포본 `kordoc@4` MCP 는 아직 Upstage 를 직접 읽지 않는다. 메신저 폴더 이미지 변환은 `~/.grok/scripts/kordoc-watch` 가 `upstage-parse.mjs` 를 호출한다.
