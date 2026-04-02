const ContentCard = ({
  title,
  content,
  priority = "secondary",
  muted = false,
  highlight = false,
}) => {
  const priorityClass =
    priority === "primary" ? "metric-card-primary" : "metric-card-secondary";

  return (
    <div
      className={`metric-card ${priorityClass} ${muted ? "metric-card-muted" : ""} ${highlight ? "metric-card-highlight" : ""}`}
    >
      <p className="metric-label">{title}</p>
      <div className="metric-value">{content}</div>
    </div>
  );
};

export default ContentCard;
