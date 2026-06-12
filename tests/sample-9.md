{
  "project": "MarkItDown VSCode Extension",
  "version": "0.1.0",
  "sprint": 4,
  "period": "2024-09-16 / 2024-09-27",
  "team": [
    { "name": "Ana Silva", "role": "Lead Developer", "availability": 1.0 },
    { "name": "Carlos Ferreira", "role": "Frontend", "availability": 0.8 },
    { "name": "Maria Santos", "role": "QA", "availability": 1.0 }
  ],
  "goals": [
    "Ship drag-and-drop file support",
    "Add token savings stats",
    "Fix Python detection on macOS",
    "Publish to VS Code Marketplace"
  ],
  "tickets": [
    {
      "id": "EXT-42",
      "title": "Drag-and-drop silently fails when setup incomplete",
      "status": "Done",
      "points": 3,
      "assignee": "Ana Silva",
      "labels": ["bug", "ux"]
    },
    {
      "id": "EXT-43",
      "title": "Detect Homebrew Python on Apple Silicon",
      "status": "Done",
      "points": 2,
      "assignee": "Ana Silva",
      "labels": ["bug", "python"]
    },
    {
      "id": "EXT-44",
      "title": "Show file-size → tokens metric for binary files",
      "status": "In Progress",
      "points": 5,
      "assignee": "Carlos Ferreira",
      "labels": ["feature", "stats"]
    },
    {
      "id": "EXT-45",
      "title": "Write extension marketplace description and screenshots",
      "status": "Todo",
      "points": 2,
      "assignee": "Maria Santos",
      "labels": ["docs", "marketing"]
    },
    {
      "id": "EXT-46",
      "title": "Add CSP-safe nonce using crypto.randomBytes",
      "status": "Done",
      "points": 1,
      "assignee": "Ana Silva",
      "labels": ["security"]
    }
  ],
  "velocity": {
    "previous_sprint": 18,
    "current_sprint_planned": 13,
    "current_sprint_done": 6
  },
  "blockers": [
    "Python 3.9 compatibility with markitdown — requires 3.10+",
    "VS Code marketplace publisher ID not yet registered"
  ],
  "retrospective": {
    "went_well": [
      "Fast iteration on bug fixes",
      "Good test coverage for Python detection logic"
    ],
    "to_improve": [
      "Need better error messages in the webview",
      "Should set up CI before marketplace publish"
    ]
  }
}
