from imsc.utils import describe_ack, error_message, phone_digits


def test_labels_each_acknowledgement_value():
    assert describe_ack(-1) == "error"
    assert describe_ack(0) == "pending"
    assert describe_ack(1) == "sent to WhatsApp"
    assert describe_ack(2) == "delivered"
    assert describe_ack(3) == "read"
    assert describe_ack(4) == "played"
    assert describe_ack(99) == "unknown (99)"


def test_strips_everything_but_digits():
    assert phone_digits("+60 12-345 6789") == "60123456789"


def test_formats_errors_and_non_errors_alike():
    assert error_message(ValueError("boom")) == "boom"
    assert error_message("boom") == "boom"
