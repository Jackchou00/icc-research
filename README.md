# ICC Table

A minimal ICC header and tag table editor built with FastAPI and React.

## Run

```bash
cd frontend
npm install
npm run build
cd ..
uv sync
uv run uvicorn app.main:app --reload
```

Open http://127.0.0.1:8000.

For frontend development, run `npm run dev` in `frontend` and FastAPI on port 8000.
