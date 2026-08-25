# AI家計簿（receipt-manager）— プロジェクト概要

> **このリポジトリは機能 A（レシート管理）である。**  
> 厳密な単価比較（機能 B）は本リポジトリの責務外。分離方針は [spec-split-receipt-and-unit-price.md](./spec-split-receipt-and-unit-price.md) を参照。

| 項目 | 内容 |
|------|------|
| リポジトリ名 | `receipt-manager` |
| プロダクト名（UI） | AI家計簿 / Receipt Manager |
| ドキュメント最終更新 | 2026-08-25 |
| 文書の扱い | **生きた概要**。機能の追加・削除・方針変更のたびに本ファイルを更新する |

---

## この文書の更新ルール

機能や環境が変わったら、最低限次を直す。

1. **§4 機能一覧** … 追加 / 削除 / ステータス変更
2. **§5 データモデル** … テーブル・主要カラムの増減
3. **§6 技術スタック / §7 環境** … 依存や起動手順の変化
4. **§10 変更履歴** … 日付と一行要約を追記

詳細な設計判断は別 md（`docs/spec-*.md` など）に切り出し、ここからはリンクする。

---

## 1. 目的

**どこで・何を・いくら使ったかを、手間少なく記録し、あとから汎用的に検索・管理・可視化する。**

- 主用途はレシート（およびカード等 CSV）の家計記録
- AI（Gemini）で OCR・カテゴリ推定・家計 Q&A を補助する
- 「100g 単価で厳密に店比較する」ことは **目的に含めない**（→ 機能 B）

---

## 2. スコープ（A / B）

| | 本プロジェクト（A） | 機能 B（別系統） |
|--|---------------------|------------------|
| 目的 | 支出の記録・検索・管理 | 意図した商品だけの厳密単価比較 |
| カテゴリ | AI / 学習の `main` / `sub` | 手動フォルダのみ |
| 単価・重量 | 扱わない（本流にしない） | g / 個 / ml 等の確定データのみ |
| 値段推移・店頭照会 | **置かない**（削除済み） | B 側で実装 |
| 連携 | B を知らない | A のレシート DB を一方向参照 |

詳細: [spec-split-receipt-and-unit-price.md](./spec-split-receipt-and-unit-price.md)

---

## 3. アーキテクチャ概要

```
Browser (React / Vite SPA)
  │  Supabase Auth（Google OAuth）
  │  一部は Supabase JS 直アクセス（RLS）
  │  /api → Vite proxy（開発） / nginx（本番）
  ▼
FastAPI (uvicorn :8000)
  │  x-supabase-token → ユーザー単位の Supabase クライアント
  │  GEMINI_API_KEY → Google Gemini
  ▼
Supabase（Auth + Postgres + RLS）
```

| 層 | パス | 役割 |
|----|------|------|
| フロントエンド | `frontend/` | SPA。機能は `src/features/` 以下 |
| バックエンド | `backend/app/` | FastAPI。Gemini / Supabase / CSV |
| DB・Auth | `supabase/` | `config.toml`、マイグレーション |
| Nginx | `nginx-config/` | 静的配信 + `/api/` リバースプロキシ |
| Compose | `docker-compose.production.yml` | 本番 FE + BE |
| CI | `.github/workflows/deploy.yml` | migrate → GHCR build → VPS deploy |
| ドキュメント | `docs/` | 本ファイルおよび仕様メモ |

---

## 4. 機能一覧

ステータス凡例:

- **現行** … 本番相当で動いている
- **強化予定** … A として伸ばす
- **削除済み** … 履歴として言及する場合のみ

### 4.1 UI タブ（`frontend/src/components/MainLayout.tsx`）

| タブ | ラベル | ステータス | 概要 |
|------|--------|------------|------|
| `register` | 登録 | 現行 | レシート撮影 / 手動入力 / CSV 読込 |
| `history` | 履歴・管理 | 現行・強化予定 | 月次履歴、編集・削除、店舗・商品・タグ検索 |
| `chat` | AIチャット | 現行 | 家計データへの自然言語 Q&A |
| `dashboard` | 統計 | 現行 | 月次カテゴリ円グラフなど |

### 4.2 機能モジュール

| 領域 | パス | ステータス | できること |
|------|------|------------|------------|
| レシート | `frontend/src/features/receipt/` | 現行 | 画像 → `/analyze` → 編集（カテゴリ・タグ等）→ `/save`。手動入力もあり |
| CSV | `frontend/src/features/csv/` | 現行 | CSV → 列マッピング（Gemini またはプリセット）→ `/save_csv` |
| 履歴 | `frontend/src/features/history/` | 現行・強化予定 | 月選択、明細編集削除、検索。サブカテゴリ検索の強化が望ましい |
| AIチャット | `frontend/src/features/search/` | 現行 | `/search` + `chat_messages` 履歴 |
| ダッシュボード | `frontend/src/features/dashboard/` | 現行 | `main_category` 集計。CSV は「キャッシュレス（未分類）」扱い |

### 4.3 バックエンド API（`backend/app/main.py`）

| Method | Path | 認証 | 用途 | ステータス |
|--------|------|------|------|------------|
| GET | `/` | 不要 | ヘルスチェック | 現行 |
| POST | `/analyze` | 要 | レシート画像の Gemini 解析 + 学習カテゴリ適用 | 現行 |
| POST | `/save` | 要 | レシート・明細の保存 | 現行 |
| POST | `/search` | 要 | 家計 Q&A | 現行 |
| GET | `/available_months` | 要 | データがある月一覧 | 現行 |
| GET | `/transactions` | 要 | 指定月のレシート + CSV | 現行 |
| POST | `/analyze_csv` | 現状不要 | CSV 列推定・パース | 現行 |
| POST | `/save_csv` | 要 | CSV 行保存 | 現行 |
| PUT/DELETE | `/receipts/{id}` | 要 | レシート更新・削除 | 現行 |
| PUT/DELETE | `/csv_transactions/{id}` | 要 | CSV 行更新・削除 | 現行 |

認証ヘッダ: `x-supabase-token`（Supabase セッションの access token）。

### 4.4 カテゴリ（A）

- Gemini 抽出時に `main_category` / `sub_category` を付与
- 同一 `item_name` の過去設定を学習して再適用（`get_learned_categories`）
- 主な `main_category` 例: 食費、日用品、交通・通信、衣服・美容、趣味・娯楽、医療・健康、住居・家具、その他
- `search_tags`（キーワード配列）で検索を補助
- **厳密比較の対象集合には使わない**（それは B の手動フォルダ）

---

## 5. データモデル（Supabase）

マイグレーション: `supabase/migrations/`  
RLS 有効。各テーブルは概ね `user_id` → `auth.users` でユーザー分離。

| テーブル | 概要 | 主なカラム | 備考 |
|----------|------|------------|------|
| `receipts` | レシート親 | `date`, `store_name`, `total_amount`, `payment_method` | |
| `receipt_items` | 明細 | `item_name`, `price`, `main_category`, `sub_category`, `search_tags` | |
| `csv_transactions` | カード等の集約行 | `date`, `store`, `price` | 明細分割なし |
| `csv_presets` | CSV 列マッピングプリセット | `name`, `mapping` (jsonb) | FE から直アクセス可 |
| `chat_messages` | AI チャット履歴 | `role`, `content` | FE から直アクセス可 |

---

## 6. 技術スタック

バージョンは宣言値ベース。正確なロックは `package-lock.json` / `uv.lock` を参照。

### フロントエンド

| 技術 | 目安 |
|------|------|
| React | ^19.2 |
| TypeScript | ~5.9 |
| Vite | ^7.2 |
| Tailwind CSS | ^4.1 |
| Axios | ^1.13 |
| @supabase/supabase-js | ^2.97 |
| Recharts | ^3.8（ダッシュボードの円グラフ） |
| Node（Docker ビルド） | 22-alpine → nginx:alpine |

### バックエンド

| 技術 | 目安 |
|------|------|
| Python | >=3.10（Docker / 実行は 3.12） |
| FastAPI | >=0.124 |
| Uvicorn | >=0.38 |
| google-genai | >=1.53（モデル例: `gemini-3-flash-preview`） |
| supabase (Python) | >=2.28 |
| Ruff | フォーマット・lint |
| パッケージ管理 | `uv` |

### インフラ・ツール

| 技術 | 用途 |
|------|------|
| Supabase | Auth / Postgres / RLS |
| Docker + Compose | 本番コンテナ |
| Nginx | SPA + `/api` プロキシ（`client_max_body_size 20M`） |
| GitHub Actions | `main` への push で migrate / GHCR push / VPS deploy |
| Husky + lint-staged | pre-commit（Prettier / ESLint / Ruff） |
| Supabase CLI | `npm run db:push` / `db:list` |

※ `gspread` は依存に残っているが、アプリ本体からは未使用。

---

## 7. 環境・起動

### 7.1 ローカル開発

リポジトリルート:

```bash
npm run dev
# FRONT: Vite（frontend）
# BACK:  uv run uvicorn app.main:app --reload（backend）
```

- 開発時、Vite が `/api` を `http://localhost:8000` へプロキシ
- DB 反映: `npm run db:push`（linked な Supabase プロジェクトへ）

### 7.2 環境変数

**フロント（`frontend/.env`、Docker ビルド時に焼込）**

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`
- API はクライアント側で `baseURL: '/api'` 想定

**バック（ローカル `.env` / 本番 compose の `env_file`）**

- `GEMINI_API_KEY`
- `SUPABASE_URL` または `VITE_SUPABASE_URL`
- `SUPABASE_KEY` または `VITE_SUPABASE_PUBLISHABLE_KEY`

`.env` および `service_account.json` は gitignore 対象。

### 7.3 本番

- イメージ: `ghcr.io/nakakonakako/receipt-manager-frontend|backend:latest`
- `docker-compose.production.yml` で FE `:80`、BE は内部 `8000`
- CI: マイグレーション → ビルド/プッシュ → VPS へ compose 適用

### 7.4 認証フロー

1. Google OAuth（Supabase Auth）
2. セッションを FE の Auth Context で保持
3. API 呼び出し時に `x-supabase-token` を付与
4. BE がそのトークンでユーザー文脈の Supabase クライアントを構築
5. 一部テーブル（チャット・CSV プリセット）は FE が RLS 経由で直接 CRUD

---

## 8. ディレクトリガイド（ざっくり）

```
receipt-manager/
├── frontend/          # React SPA
│   └── src/
│       ├── components/    # レイアウト、認証、登録ハブなど
│       ├── features/      # 機能単位（receipt, csv, history, …）
│       ├── hooks/
│       └── lib/           # apiClient 等
├── backend/
│   └── app/
│       ├── main.py
│       ├── schemas/
│       └── services/      # gemini, supabase, csv
├── supabase/migrations/
├── nginx-config/
├── docs/              # 本ドキュメント群
└── docker-compose.production.yml
```

---

## 9. 関連ドキュメント

| 文書 | 内容 |
|------|------|
| [README.md](./README.md) | docs 索引 |
| [spec-split-receipt-and-unit-price.md](./spec-split-receipt-and-unit-price.md) | A/B 分離・メモ削除・カテゴリ方針 |

新規の仕様・設計メモを足したら、上記索引と本節にも行を追加する。

---

## 10. 変更履歴（このドキュメント）

| 日付 | 内容 |
|------|------|
| 2026-08-25 | メモ機能・`is_comparable`・`memo_rows` を削除。値段推移は B 側へ移管する方針 |
| 2026-08-25 | 初版。A の目的・機能・環境・A/B 境界を整理。メモは削除予定として記載 |
