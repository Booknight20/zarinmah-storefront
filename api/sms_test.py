import json
import os
import secrets
import urllib.error
import urllib.request
import xml.etree.ElementTree as ET


SOAP_ENDPOINT = "https://payammatni.com:443/webservice/send.php"
SOAP_ENV = "http://schemas.xmlsoap.org/soap/envelope/"
SOAP_ENC = "http://schemas.xmlsoap.org/soap/encoding/"
XSD = "http://www.w3.org/2001/XMLSchema"
XSI = "http://www.w3.org/2001/XMLSchema-instance"
SERVICE_NS = "Send_API"


def response(status, payload):
    from http.server import BaseHTTPRequestHandler

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            self.send_json(status, payload)

        def do_POST(self):
            self.send_json(status, payload)

        def send_json(self, code, data):
            body = json.dumps(data, ensure_ascii=False).encode("utf-8")
            self.send_response(code)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, *_args):
            pass

    return Handler


def handler(request):
    if request.method != "POST":
        return response(405, {"ok": False, "error": "فقط درخواست POST مجاز است."})()

    expected_secret = os.environ.get("SMS_TEST_SECRET", "")
    supplied_secret = request.headers.get("x-test-secret", "")
    if not expected_secret or not secrets.compare_digest(supplied_secret, expected_secret):
        return response(401, {"ok": False, "error": "دسترسی غیرمجاز."})()

    username = os.environ.get("SMS_USERNAME", "")
    password = os.environ.get("SMS_PASSWORD", "")
    destination = os.environ.get("SMS_TEST_TO", "")
    sender = "80008"

    if not all((username, password, destination)):
        return response(500, {"ok": False, "error": "تنظیمات پیامک کامل نیست."})()

    # متن ثابت آزمایشی؛ شماره مقصد از متغیر امن سرور خوانده می‌شود.
    message = "پیام آزمایشی سامانه زرین ماه"
    envelope = ET.Element(f"{{{SOAP_ENV}}}Envelope")
    envelope.set(f"{{{SOAP_ENV}}}encodingStyle", SOAP_ENC)
    body = ET.SubElement(envelope, f"{{{SOAP_ENV}}}Body")
    operation = ET.SubElement(body, f"{{{SERVICE_NS}}}SendSMS")

    from_num = ET.SubElement(operation, "fromNum")
    from_num.set(f"{{{XSI}}}type", "xsd:string")
    from_num.text = sender

    to_num = ET.SubElement(operation, "toNum")
    to_num.set(f"{{{XSI}}}type", "SOAP-ENC:Array")
    to_num.set(f"{{{SOAP_ENC}}}arrayType", "xsd:string[1]")
    item = ET.SubElement(to_num, "item")
    item.set(f"{{{XSI}}}type", "xsd:string")
    item.text = destination

    content = ET.SubElement(operation, "Content")
    content.set(f"{{{XSI}}}type", "xsd:string")
    content.text = message

    sms_type = ET.SubElement(operation, "Type")
    sms_type.set(f"{{{XSI}}}type", "xsd:string")
    sms_type.text = "0"

    user_node = ET.SubElement(operation, "Username")
    user_node.set(f"{{{XSI}}}type", "xsd:string")
    user_node.text = username

    pass_node = ET.SubElement(operation, "Password")
    pass_node.set(f"{{{XSI}}}type", "xsd:string")
    pass_node.text = password

    payload = ET.tostring(envelope, encoding="utf-8", xml_declaration=True)
    req = urllib.request.Request(
        SOAP_ENDPOINT,
        data=payload,
        headers={
            "Content-Type": "text/xml; charset=utf-8",
            "SOAPAction": "SendSMS",
        },
        method="POST",
    )

    try:
        with urllib.request.urlopen(req, timeout=20) as result:
            xml_result = result.read()
        root = ET.fromstring(xml_result)
        fault = root.find(f".//{{{SOAP_ENV}}}Fault")
        if fault is not None:
            fault_text = " ".join(t.strip() for t in fault.itertext() if t.strip())
            return response(502, {"ok": False, "error": "خطای SOAP از سرویس‌دهنده.", "detail": fault_text[:500]})()

        values = [v.strip() for v in root.itertext() if v and v.strip()]
        code = next((v for v in values if v.isdigit() and len(v) != 11), None)
        message_id = next((v for v in values if v.isdigit() and len(v) == 11), None)

        if message_id:
            return response(200, {"ok": True, "message": "درخواست ارسال پذیرفته شد.", "message_id": message_id})()
        if code is not None:
            return response(200, {"ok": False, "provider_code": code, "message": "سرویس‌دهنده درخواست را با کد خطا رد کرد."})()
        return response(502, {"ok": False, "error": "پاسخ سرویس‌دهنده قابل تشخیص نبود."})()

    except urllib.error.HTTPError as exc:
        return response(502, {"ok": False, "error": "خطای HTTP از سرویس پیامک.", "status": exc.code})()
    except Exception:
        return response(502, {"ok": False, "error": "ارتباط با سرویس پیامک ناموفق بود."})()


# Vercel Python runtime entrypoint
def main(request):
    return handler(request)
