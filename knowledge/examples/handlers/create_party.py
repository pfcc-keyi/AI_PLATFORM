"""Handler: create_party

Accepts a flattened payload, routes by type, creates Party + PartyCorp or Party + PartyPerson
in a single atomic transaction.

Payload (CORP):
    type, description, legal_form, entity_name, country_of_domicile, listed_ind
    optional: short_name, short_code, local_name,
              country_of_incorporation, market_id, isin_code, industry_type

Payload (PERSON):
    type, description, first_name, last_name
    optional: short_name, short_code,
              title, mid_name, preferred_name,
              first_name_local, last_name_local, mid_name_local, preferred_name_local,
              local_lang, gender, date_of_birth,
              nationality, country_of_residence, country_of_birth,
              education_level, marital_status

Endpoint: POST /api/handlers/create_party
"""
from datetime import date

from lib.handler.errors import HandlerError

MODE = "sync"

_CORP_OPTIONAL = {
    "country_of_incorporation", "market_id", "isin_code", "industry_type",
}

_PERSON_OPTIONAL = {
    "title", "mid_name", "preferred_name",
    "first_name_local", "last_name_local", "mid_name_local", "preferred_name_local",
    "local_lang", "gender", "date_of_birth",
    "nationality", "country_of_residence", "country_of_birth",
    "education_level", "marital_status",
}


def _pick(payload: dict, keys: set) -> dict:
    return {k: payload[k] for k in keys if k in payload}


async def handle(ctx, payload: dict) -> dict:
    party_type = (payload.get("type") or "").upper()

    if party_type == "CORP":
        party_data = {
            "type":        payload["type"],
            "description": payload["description"],
            "name":        payload["entity_name"],
            **_pick(payload, {"short_name", "short_code", "local_name"}),
        }
        party = await ctx.party.create_party_active(data=party_data)
        party_id = party["data"]["party_id"]

        corp_data = {
            "party_id":            party_id,
            "legal_form":          payload["legal_form"],
            "entity_name":         payload["entity_name"],
            "country_of_domicile": payload["country_of_domicile"],
            "listed_ind":          payload["listed_ind"],
            **_pick(payload, _CORP_OPTIONAL),
        }
        corp = await ctx.party_corp.create_party_corp_active(data=corp_data)

        return {"party": party["data"], "party_corp": corp["data"]}

    elif party_type == "PERSON":
        party_data = {
            "type":        payload["type"],
            "description": payload["description"],
            "name":        f"{payload['first_name']} {payload['last_name']}",
            **_pick(payload, {"short_name", "short_code"}),
        }
        party = await ctx.party.create_party_active(data=party_data)
        party_id = party["data"]["party_id"]

        person_data = {
            "party_id":   party_id,
            "first_name": payload["first_name"],
            "last_name":  payload["last_name"],
            **_pick(payload, _PERSON_OPTIONAL),
        }
        if "date_of_birth" in person_data and isinstance(person_data["date_of_birth"], str):
            person_data["date_of_birth"] = date.fromisoformat(person_data["date_of_birth"])
        person = await ctx.party_person.create_party_person_active(data=person_data)

        return {"party": party["data"], "party_person": person["data"]}

    else:
        raise HandlerError(
            message=f"'type' must be 'CORP' or 'PERSON', got: '{payload.get('type')}'",
            code="INVALID_INPUT",
            http_status=400,
        )
