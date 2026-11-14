# Console bundle image (Requirement 21.22, design: Console built into the API image).
# Holds only the built static files at /. It is never run: the Depot API image copies it in with
#   COPY --from=fholisani/depot-console-bundle:<tag> / /app/static/depot-console/
# so each blue/green slot serves the Console it was built with.
FROM scratch
COPY dist/depot-console/browser/ /
