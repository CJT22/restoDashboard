"""Shared SQL filters for sales report queries.

Exclude cancelled (STATUS = -1) and deleted (STATUS = -2) orders and billing
from sales computations.
"""

from typing import List, Tuple

SALES_EXCLUDED_STATUSES = "(-1, -2)"


def order_status_ok(alias: str = "o") -> str:
    return f"{alias}.STATUS NOT IN {SALES_EXCLUDED_STATUSES}"


def billing_status_ok(alias: str = "b") -> str:
    return f"{alias}.STATUS NOT IN {SALES_EXCLUDED_STATUSES}"


def billing_join_on(order_alias: str = "o", billing_alias: str = "b", *, include_paid: bool = True) -> str:
    paid = f" AND {billing_alias}.STATUS IN (1, 2)" if include_paid else ""
    return (
        f"{billing_alias}.ORDER_ID = {order_alias}.IDNo"
        f"{paid} AND {billing_status_ok(billing_alias)} AND {order_status_ok(order_alias)}"
    )


def orders_join_on_billing(billing_alias: str = "b", order_alias: str = "o") -> str:
    return f"{order_alias}.IDNo = {billing_alias}.ORDER_ID AND {order_status_ok(order_alias)}"


def billing_where_clauses(*, include_paid: bool = True, billing_alias: str = "b") -> str:
    parts: list[str] = []
    if include_paid:
        parts.append(f"{billing_alias}.STATUS IN (1, 2)")
    parts.append(billing_status_ok(billing_alias))
    return " AND ".join(parts)


def ph_local_day_range_predicate(column: str) -> str:
    """Sargable PH(+08:00) inclusive day range on a raw datetime column.

    CONVERT_TZ / DATE_ADD are applied to *constants* only so MySQL can use an
    index on ``column`` (unlike ``DATE(CONVERT_TZ(column, ...)) BETWEEN ...``).
    Placeholders: start, start, end, end.
    """
    return (
        f"{column} >= COALESCE("
        f"CONVERT_TZ(CONCAT(%s, ' 00:00:00'), '+08:00', @@session.time_zone), "
        f"DATE_SUB(CONCAT(%s, ' 00:00:00'), INTERVAL 8 HOUR)"
        f") AND {column} < COALESCE("
        f"CONVERT_TZ(DATE_ADD(CONCAT(%s, ' 00:00:00'), INTERVAL 1 DAY), '+08:00', @@session.time_zone), "
        f"DATE_SUB(DATE_ADD(CONCAT(%s, ' 00:00:00'), INTERVAL 1 DAY), INTERVAL 8 HOUR)"
        f")"
    )


def ph_local_day_range_params(start_date: str, end_date: str) -> List[object]:
    return [start_date, start_date, end_date, end_date]


def ph_local_day_range_filter(column: str, start_date: str, end_date: str) -> Tuple[str, List[object]]:
    """Returns (``AND <predicate>``, params) for a PH-local inclusive date range."""
    return f"AND {ph_local_day_range_predicate(column)}", ph_local_day_range_params(start_date, end_date)
