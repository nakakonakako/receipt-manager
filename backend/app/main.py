from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from app.services.gemini_service import GeminiService

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

gemini_service = GeminiService()

@app.get("/")
def read_root():
    return {"message": "Receipt Manager API is running."}

@app.post("/analyze")
async def analyze_receipt(file: UploadFile = File(...)):
    try:
        image_bytes = await file.read()
        result = gemini_service.analyze_receipt(image_bytes)
        
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))