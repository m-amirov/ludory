{
  "targets": [
    {
      "target_name": "directory_pin",
      "sources": ["directory-pin.c"],
      "conditions": [["OS!='win'", { "type": "none" }]]
    }
  ]
}
