from frappe.model.document import Document
from as_industries.tickets import validate_ticket

class ASSupportTicket(Document):
    def validate(self):
        validate_ticket(self)
