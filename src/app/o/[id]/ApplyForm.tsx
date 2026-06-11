"use client";

import { useState } from "react";
import { applyAction } from "./actions";

interface DateOption {
  id: string;
  label: string;
}

/**
 * Scope choice (whole series vs. specific dates) + optional message.
 * Client component only for the radio toggle — submission is the plain
 * applyAction server action.
 */
export function ApplyForm({
  opportunityId,
  dates,
}: {
  opportunityId: string;
  dates: DateOption[];
}) {
  const [scope, setScope] = useState<"series" | "dates">("series");
  const offerScopeChoice = dates.length > 1;

  return (
    <form action={applyAction} className="mt-4 space-y-4 text-left">
      <input type="hidden" name="opportunityId" value={opportunityId} />
      {offerScopeChoice ? (
        <fieldset>
          <legend className="text-sm font-medium">Apply for</legend>
          <div className="mt-2 space-y-2 text-sm">
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name="scope"
                value="series"
                checked={scope === "series"}
                onChange={() => setScope("series")}
              />
              All dates (the whole series)
            </label>
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name="scope"
                value="dates"
                checked={scope === "dates"}
                onChange={() => setScope("dates")}
              />
              Specific dates only
            </label>
          </div>
          {scope === "dates" ? (
            <div className="mt-3 max-h-48 space-y-1.5 overflow-y-auto rounded-lg border border-line p-3 text-sm">
              {dates.map((date) => (
                <label key={date.id} className="flex items-center gap-2">
                  <input type="checkbox" name="occurrenceIds" value={date.id} />
                  {date.label}
                </label>
              ))}
            </div>
          ) : null}
        </fieldset>
      ) : (
        <input type="hidden" name="scope" value="series" />
      )}
      <label className="block text-sm">
        <span className="font-medium">Message to the business (optional)</span>
        <textarea
          name="message"
          rows={3}
          maxLength={2000}
          className="oc-input mt-1 w-full"
          placeholder="Availability notes, relevant experience, questions…"
        />
      </label>
      <button type="submit" className="oc-btn">
        Send application
      </button>
    </form>
  );
}
