from flask import Flask, request, jsonify
import pytesseract
from PIL import Image

app = Flask(__name__)

@app.route("/ocr", methods=["POST"])
def ocr():
    file = request.files["file"]
    img = Image.open(file.stream)
    text = pytesseract.image_to_string(img)
    return jsonify({"extracted_text": text})

if __name__ == "__main__":
    app.run(port=6000, debug=True)