const ContentCard = ({ title, content }) => {
  return (
    <>
      <div
        className="card mb-3"
        style={{ maxWidth: "18rem", minWidth: "18rem" }}
      >
        <div className="card-header">{title}</div>
        <div className="card-body">
          {/* <h5 class="card-title">Primary card title</h5> */}
          <p className="card-text">{content}</p>
        </div>
      </div>
    </>
  );
};
export default ContentCard;
