import json
import os
import secrets
import urllib.error
import urllib.request
import xml.etree.ElementTree as ET
from http.server import BaseHTTPRequestHandler

SOAP_ENV = "http://schemas.xmlsoap.org/soap/envelope/"
SOAP_ENC = "http://schemas.xmlsoap.org/soap/encoding/"
XSI = "http://www.w3.org/2001/XMLSchema-instance"
SERVICE_NS = "Send_API"
SOAP_ENDPOINT = "https://payammatni.com:443/webservice/send.php"

ET.register_namespace("SOAP-ENV", SOAP_ENV)
ET.register_namespace("SOAP-ENC", SOAP_ENC)
ET.register_namespace("xsi", XSI)


def add_string(parent, name, value):
    node = ET.SubElement(parent, name)
    node.set(f"{{{XSI}}}type", "xsd:string")
    node.text = value
    return node


class handler(BaseHTTPRequestHandler):
    def _json(self, status, data):
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        self._json(405, {"ok": False, "error": "فقط درخواست POST مجاز است."})

    def do_POST(self):
        expected = os.environ.get("SMS_TEST_SECRET", "")
        supplied = self.headers.get("X-Test-Secret", "")
        if not expected or not secrets.compare_digest(supplied, expected):
            self._json(401, {"ok": False, "error": "دسترسی غیرمجاز."})
            return

        username = os.environ.get("SMS_USERNAME", "")
        password = os.environ.get("SMS_PASSWORD", "")
        destination = os.environ.get("SMS_TEST_TO", "")
        if not all((username, password, destination)):
            self._json(500, {"ok": False, "error": "تنظیمات پیامک کامل نیست."})
            return

        envelope = ET.Element(f"{{{SOAP_ENV}}}Envelope")
        envelope.set(f"{{{SOAP_ENV}}}encodingStyle", SOAP_ENC)
        body = ET.SubElement(envelope, f"{{{SOAP_ENV}}}Body")
        operation = ET.SubElement(body, f"{{{SERVICE_NS}}}SendSMS")

        add_string(operation, "fromNum", "80008")
        to_num = ET.SubElement(operation, "toNum")
        to_num.set(f"{{{XSI}}}type", "SOAP-ENC:Array")
        to_num.set(f"{{{SOAP_ENC}}}arrayType", "xsd:string[1]")
        item = ET.SubElement(to_num, "item")
        item.set(f"{{{XSI}}}type", "xsd:string")
        item.text = destination

        add_string(operation, "Content", "پیام آزمایشی سامانه زرین ماه")
        add_string(operation, "Type", "0")
        add_string(operation, "Username", username)
        add_string(operation, "Password", password)

        soap_xml = ET.tostring(envelope, encoding="utf-8", xml_declaration=True)
        req = urllib.request.Request(
            SOAP_ENDPOINT,
            data=soap_xml,
            headers={
                "Content-Type": "text/xml; charset=utf-8",
                "SOAPAction": "SendSMS",
            },
            method="POST",
        )

        try:
            with urllib.request.urlopen(req, timeout=20) as result:
                response_xml = result.read()
            root = ET.fromstring(response_xml)

            fault = root.find(f".//{{{SOAP_ENV}}}Fault")
            if fault is not None:
                fault_text = " ".join(t.strip() for t in fault.itertext() if t.strip())
                self._json(502, {
                    "ok": False,
                    "error": "خطای SOAP از سرویس‌دهنده.",
                    "detail": fault_text[:400],
                })
                return

            return_node = next(
                (node for node in root.iter() if node.tag.split("}")[-1] == "return"),
                None,
            )
            values = []
            if return_node is not None:
                values = [
                    value.strip()
                    for value in return_node.iter()
                    if value.text and value.text.strip()
                ]
                if return_node.text and return_node.text.strip():
                    values.insert(0, return_node.text.strip())

            message_id = next(
                (value for value in values if value.isdigit() and len(value) == 11),
                None,
            )
            error_code = next(
                (value for value in values if value.isdigit() and len(value) != 11),
                None,
            )

            if message_id:
                self._json(200, {
                    "ok": True,
                    "message": "درخواست ارسال پذیرفته شد.",
                    "message_id": message_id,
                })
            elif error_code is not None:
                self._json(200, {
                    "ok": False,
                    "provider_code": error_code,
                    "message": "سرویس‌دهنده درخواست را با کد خطا رد کرد.",
                })
            else:
                self._json(502, {
                    "ok": False,
                    "error": "ساختار پاسخ سرویس‌دهنده قابل تشخیص نبود.",
                })

        except urllib.error.HTTPError as exc:
            self._json(502, {
                "ok": False,
                "error": "خطای HTTP از سرویس پیامک.",
                "status": exc.code,
            })
        except Exception:
            self._json(502, {
                "ok": False,
                "error": "ارتباط با سرویس پیامک ناموفق بود.",
            })

    def log_message(self, *_args):
        pass
