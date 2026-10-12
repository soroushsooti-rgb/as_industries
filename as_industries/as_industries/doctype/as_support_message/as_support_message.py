from frappe.model.document import Document
from as_industries.tickets import validate_message

class ASSupportMessage(Document):
    def validate(self):
        validate_message(self)
